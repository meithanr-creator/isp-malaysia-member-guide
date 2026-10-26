require "test_helper"
require "timeout"
require "stringio"

class UploadOperationTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @records = []
    @operations = []
    @old_blob_ids = []
    @admin = create_member(role: "admin")
    @authentication = UserSession.issue(@admin,
      authenticated_password_digest: @admin.password_digest).first
  end

  teardown do
    @records.reverse_each { |record| record.destroy! if record.persisted? }
    ids = @old_blob_ids + @operations.flat_map do |operation|
      ActiveStorage::Blob.where("key LIKE ?",
        "managed-uploads/#{operation.id}/%").pluck(:id)
    end
    ActiveStorage::Blob.where(id: ids.uniq).find_each do |blob|
      blob.purge unless ActiveStorage::Attachment.where(blob_id: blob.id).exists?
    end
    AdministrativeAudit.where(actor_id: @admin.id).delete_all if @admin
    @admin.destroy! if @admin&.persisted?
    close_discover_uploads
  end

  test "first PUT partial failure is compensated in every upload area" do
    %i[event publication discover].each do |area|
      record, operation, apply = scenario(area)
      before = record_state(record)
      service = ActiveStorage::Blob.service
      original = service.method(:upload)
      written = []
      service.stub(:upload, lambda { |key, io, **options|
        original.call(key, io, **options)
        written << key
        raise IOError, "controlled post-PUT failure"
      }) do
        assert_raises(UploadOperation::StorageFailure) { operation.run(&apply) }
      end
      assert_preserved(record, before)
      assert_tombstones(operation)
      written.each { |key| assert_not service.exist?(key) }
    end
  end

  test "second PUT failure cleans both new keys and preserves published attachments" do
    %i[event publication].each do |area|
      record, operation, apply = scenario(area)
      before = record_state(record)
      service = ActiveStorage::Blob.service
      original = service.method(:upload)
      written = []
      service.stub(:upload, lambda { |key, io, **options|
        original.call(key, io, **options)
        written << key
        raise IOError, "controlled second PUT failure" if written.length == 2
      }) do
        assert_raises(UploadOperation::StorageFailure) { operation.run(&apply) }
      end
      assert_equal 2, written.length
      assert_preserved(record, before)
      assert_tombstones(operation)
      written.each { |key| assert_not service.exist?(key) }
    end
  end

  test "post-upload audit rollback compensates only newly owned objects" do
    %i[event publication discover].each do |area|
      record, operation, apply = scenario(area)
      before = record_state(record)
      AdministrativeAudit.stub(:create!, lambda { |*_args, **_options|
        raise ActiveRecord::RecordInvalid.new(AdministrativeAudit.new)
      }) do
        assert_raises(AdministrativeAction::AuditFailure) { operation.run(&apply) }
      end
      assert_preserved(record, before)
      assert_tombstones(operation)
    end
  end

  test "database failure after uploads preserves old files and cleans new objects" do
    %i[event publication discover].each do |area|
      record, operation, apply = scenario(area)
      before = record_state(record)
      record.stub(:save!, lambda { |*_args, **_options|
        raise ActiveRecord::StatementInvalid, "controlled database failure"
      }) do
        assert_raises(ActiveRecord::StatementInvalid) { operation.run(&apply) }
      end
      assert_preserved(record, before)
      assert_tombstones(operation)
    end
  end

  test "failed compensation retains committed keys for operation-scoped retry" do
    record, operation, apply = scenario(:publication)
    before = record_state(record)
    service = ActiveStorage::Blob.service
    original = service.method(:upload)
    service.stub(:upload, lambda { |key, io, **options|
      original.call(key, io, **options)
      raise IOError, "controlled post-PUT failure"
    }) do
      service.stub(:delete, ->(*) { raise IOError, "controlled delete failure" }) do
        assert_raises(UploadOperation::StorageFailure) { operation.run(&apply) }
      end
    end
    assert_equal 2, ledger(operation).count
    assert ledger(operation).all? { |blob|
      blob.metadata.fetch(UploadOperation::LEDGER).fetch("state") == "tombstone"
    }
    assert_preserved(record, before)
    result = UploadOperation.recover!(operation_id: operation.id)
    assert_equal 0, result[:deleted]
    assert_equal 2, result[:pending]
    assert_tombstones(operation)
  end

  test "failed confirming HEAD retains the ledger even when DELETE succeeded" do
    _record, operation, apply = scenario(:discover)
    service = ActiveStorage::Blob.service
    original = service.method(:upload)
    service.stub(:upload, lambda { |key, io, **options|
      original.call(key, io, **options)
      raise IOError, "controlled post-PUT failure"
    }) do
      service.stub(:exist?, ->(*) { raise IOError, "controlled HEAD failure" }) do
        assert_raises(UploadOperation::StorageFailure) { operation.run(&apply) }
      end
    end
    assert_equal 1, ledger(operation).count
    assert_equal 1, UploadOperation.recover!(operation_id: operation.id)[:pending]
    assert_tombstones(operation)
  end

  test "scanner rejection prevents every PUT and ledger creation in all areas" do
    %i[event publication discover].each do |area|
      record, operation, apply = scenario(area)
      before = record_state(record)
      UploadScanner.stub(:error, "This file did not pass the upload safety check.") do
        ActiveStorage::Blob.service.stub(:upload, ->(*) { flunk "Rejected file reached PUT" }) do
          assert_not operation.run(&apply)
        end
      end
      assert_empty ledger(operation)
      assert_preserved(record, before)
    end
  end

  test "ledger commit survives rollback of the authoritative mutation" do
    record, operation, _apply = scenario(:publication)
    before = record_state(record)
    operation.run do |uploads|
      assert_equal 2, ledger(operation).count
      ApplicationRecord.transaction do
        uploads.upload("pdf")
        raise ActiveRecord::Rollback
      end
      # These rows were committed before the rolled-back application transaction.
      assert_equal 2, ledger(operation).count
      false
    end
    assert_tombstones(operation)
    assert_preserved(record, before)
  end

  test "real application transaction cannot prepare a ledger" do
    _record, operation, apply = scenario(:publication)
    ApplicationRecord.transaction do
      assert_raises(UploadOperation::BoundaryError) { operation.run(&apply) }
    end
    assert_empty ledger(operation)
  end

  test "recovery cannot delete a PUT held by an attachment transaction" do
    skip "PostgreSQL row-lock proof requires TEST_DATABASE_URL" unless
      ApplicationRecord.connection.adapter_name == "PostgreSQL"

    record, operation, apply = scenario(:discover)
    service = ActiveStorage::Blob.service
    original = service.method(:upload)
    entered = Queue.new
    release = Queue.new
    finished = Queue.new
    uploader = nil

    service.stub(:upload, lambda { |key, io, **options|
      original.call(key, io, **options)
      entered << key
      Timeout.timeout(10) { release.pop }
    }) do
      uploader = Thread.new do
        ApplicationRecord.connection_pool.with_connection do
          finished << operation.run(&apply)
        end
      rescue StandardError => error
        finished << error
      end
      uploader.report_on_exception = false
      key = Timeout.timeout(10) { entered.pop }
      connection = ApplicationRecord.connection
      begin
        connection.execute("SET lock_timeout = '100ms'")
        result = UploadOperation.recover!(operation_id: operation.id)
        assert_equal 1, result[:pending]
        assert service.exist?(key)
      ensure
        connection.execute("SET lock_timeout = '0'")
        release << true
      end
      outcome = Timeout.timeout(10) { finished.pop }
      raise outcome if outcome.is_a?(Exception)
      assert outcome
      uploader.join(2)
      assert record.reload.image.attached?
      assert_equal 1, UploadOperation.recover!(operation_id: operation.id)[:retained]
      assert service.exist?(record.image.blob.key)
    end
  ensure
    if uploader&.alive?
      release << true
      uploader.join(12)
    end
  end

  test "late PUT remains recoverable after DELETE and absent HEAD" do
    record, operation, apply = scenario(:discover)
    before = record_state(record)
    service = ActiveStorage::Blob.service
    original = service.method(:upload)
    delayed = nil
    service.stub(:upload, lambda { |key, io, **options|
      delayed = [key, io.read, options]
      raise IOError, "controlled ambiguous PUT timeout"
    }) do
      assert_raises(UploadOperation::StorageFailure) { operation.run(&apply) }
    end
    key, bytes, options = delayed
    blob = ledger(operation).sole
    assert_tombstones(operation)
    original.call(key, StringIO.new(bytes), **options)
    assert service.exist?(key)
    assert_equal 1, UploadOperation.recover!(operation_id: operation.id)[:pending]
    assert_equal blob.id, ledger(operation).sole.id
    assert_tombstones(operation)
    assert_equal 1, UploadOperation.recover!(operation_id: operation.id)[:pending]
    assert_equal blob.id, ledger(operation).sole.id
    assert_preserved(record, before)
  end

  test "recovery commits its fence before failed deletion and blocks a queued PUT" do
    _record, operation, _apply = scenario(:discover)
    service = ActiveStorage::Blob.service
    operation.run do |uploads|
      service.stub(:delete, ->(*) { raise IOError, "controlled cleanup failure" }) do
        assert_equal 1, UploadOperation.recover!(operation_id: operation.id)[:pending]
      end
      assert_equal "tombstone", ledger(operation).sole.metadata.fetch(UploadOperation::LEDGER).fetch("state")
      ApplicationRecord.transaction do
        service.stub(:upload, ->(*) { flunk "Fenced key reached PUT" }) do
          assert_raises(UploadOperation::UnsafeLedger) { uploads.upload("image") }
        end
      end
      false
    end
    assert_tombstones(operation)
  end
  private

  def assert_tombstones(operation)
    assert_equal operation.slots.length, ledger(operation).count
    ledger(operation).each do |blob|
      UploadOperation.verify_owned!(blob, operation.id)
      assert_equal "tombstone", blob.metadata.fetch(UploadOperation::LEDGER).fetch("state")
      assert_not ActiveStorage::Attachment.where(blob_id: blob.id).exists?
      assert_not blob.service.exist?(blob.key)
    end
  end
  def ledger(operation)
    ActiveStorage::Blob.where("key LIKE ?", "managed-uploads/#{operation.id}/%")
  end

  def blobs_for(record)
    record.is_a?(DiscoverSlide) ? [record.image.blob].compact : record.uploads.blobs.to_a
  end

  def record_state(record)
    record.reload
    {
      attributes: record.attributes.deep_dup,
      blobs: blobs_for(record).to_h { |blob| [blob.id, Digest::SHA256.hexdigest(blob.download)] }
    }
  end

  def assert_preserved(record, before)
    assert_equal before.fetch(:attributes), record.reload.attributes
    assert_equal before.fetch(:blobs).keys.sort, blobs_for(record).map(&:id).sort
    before.fetch(:blobs).each do |id, digest|
      assert_equal digest, Digest::SHA256.hexdigest(ActiveStorage::Blob.find(id).download)
    end
  end

  def scenario(area)
    case area
    when :event
      record = create_event
      assert EventDraftUpdater.new(record).call(attributes: {},
        images: [discover_upload(filename: "old-event.png")],
        brochure: discover_upload(content: "%PDF-1.7 old event", filename: "old-event.pdf", type: "application/pdf"),
        expected_lock_version: record.lock_version)
      record.prepare_preview!
      record.publish!(expected_revision: record.revision)
      operation = UploadOperation.for_event(record,
        images: [discover_upload(filename: "new-event.png")],
        brochure: discover_upload(content: "%PDF-1.7 new event", filename: "new-event.pdf", type: "application/pdf"))
    when :publication
      record = create_published_publication
      operation = UploadOperation.for_publication(
        pdf: discover_upload(content: "%PDF-1.7 replacement", filename: "new-book.pdf", type: "application/pdf"),
        cover: discover_upload(filename: "new-cover.png"))
    when :discover
      record = create_discover_slide(position: ([1, 2, 3] - DiscoverSlide.pluck(:position)).first)
      assert DiscoverSlideUpdater.new(record).call(attributes: {},
        image: discover_upload(filename: "old-card.png"),
        expected_lock_version: record.lock_version)
      operation = UploadOperation.for_discover(image: discover_upload(filename: "new-card.png"))
    end
    @records << record
    @operations << operation
    @old_blob_ids.concat(blobs_for(record).map(&:id))
    record.reload
    version = record.lock_version

    apply = lambda do |uploads|
      AdministrativeAction.call(actor: @admin, authentication: @authentication,
        target: record, action: "upload_failure_test") do
        case area
        when :event
          EventDraftUpdater.new(record).call(
            attributes: { "title" => "Replacement event" },
            expected_lock_version: version, uploads: uploads)
        when :publication
          PublicationDraftUpdater.new(record).call(
            attributes: { "title" => "Replacement publication" },
            expected_lock_version: version, uploads: uploads)
        when :discover
          DiscoverSlideUpdater.new(record).call(
            attributes: { "title" => "Replacement card" },
            expected_lock_version: version, uploads: uploads)
        end
      end
    end
    [record, operation, apply]
  end
end

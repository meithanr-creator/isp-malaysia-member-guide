require "digest"
require "json"
require "securerandom"

class UploadOperation
  class BoundaryError < StandardError; end
  class UnsafeLedger < StandardError; end
  class StorageFailure < StandardError; end

  MESSAGE = "The file could not be stored safely. Nothing was published. Please try again later."
  LEDGER = "isp_upload_operation"
  PREFIX = "managed-uploads"
  MAX_FILES = 4
  UUID = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/

  Entry = Struct.new(:slot, :file, :validator, :blob, keyword_init: true)
  attr_reader :id, :errors

  def self.for_event(event, images: [], brochure: nil, remove_images: [])
    files = Array(images).reject(&:blank?)
    removed = Array(remove_images).map(&:to_s)
    existing = Array(event.draft_data&.fetch("images", []))
    retained = existing.each_index.count { |index| !removed.include?(index.to_s) }
    errors = retained + files.length > 3 ?
      [[:base, "Choose up to three event images in total."]] : []

    entries = files.each_with_index.map do |file, index|
      Entry.new(slot: "image_#{index}", file: file,
        validator: ->(value) { LocalFileValidator.error(value, kind: :image) })
    end
    if brochure.present?
      entries << Entry.new(slot: "brochure", file: brochure,
        validator: ->(value) { LocalFileValidator.error(value, kind: :pdf) })
    end
    new(entries: entries, errors: errors)
  end

  def self.for_publication(pdf: nil, cover: nil)
    entries = { "pdf" => pdf, "cover" => cover }.filter_map do |kind, file|
      next if file.blank?
      Entry.new(slot: kind, file: file,
        validator: ->(value) { PublicationFileValidator.error(value, kind: kind) })
    end
    new(entries: entries)
  end

  def self.for_discover(image: nil)
    entries = image.blank? ? [] : [
      Entry.new(slot: "image", file: image,
        validator: ->(value) { LocalFileValidator.error(value, kind: :image) })
    ]
    new(entries: entries)
  end

  def initialize(entries:, errors: [])
    @id = SecureRandom.uuid
    @entries = entries
    @errors = errors.dup
    @attempted = {}
    @used = false
    @prepared = false
    @registration_started = false
  end

  # Must surround AdministrativeAction, not run inside it. Blob rows committed
  # here are the durable exact-key ledger even if the later transaction rolls back.
  def run
    raise BoundaryError, "Upload operations cannot be reused" if @used
    @used = true
    self.class.assert_boundary! unless @entries.empty?
    @phase = "validation"
    validate_files!
    @prepared = true

    if errors.empty? && @entries.any?
      @phase = "ledger"
      @registration_started = true
      register!
    end

    @phase = "apply"
    yield self
  rescue StandardError => error
    self.class.log(id, @phase || "preparation", error)
    raise
  ensure
    if @registration_started
      begin
        self.class.recover!(operation_id: id)
      rescue StandardError => error
        # An unknown transaction outcome or unavailable database must never
        # cause deletion. The committed ledger remains available for recovery.
        self.class.log(id, "cleanup_deferred", error)
      end
    end
  end

  def slots = @entries.map(&:slot)

  def apply_errors(record)
    raise BoundaryError, "Upload operation was not prepared" unless @prepared
    errors.each { |field, message| record.errors.add(field, message) }
  end

  # Every PUT shares this Blob row lock with recovery. A recovery that wins
  # first commits a non-uploadable tombstone, so a queued PUT is refused.
  def upload(slot)
    raise BoundaryError, "Upload operation was not prepared" unless @prepared
    raise BoundaryError, "Rejected uploads cannot be stored" if errors.any?
    raise BoundaryError, "A PUT cannot be replayed" if @attempted[slot]

    connection = ApplicationRecord.connection
    unless connection.transaction_open? && connection.current_transaction.joinable?
      raise BoundaryError, "PUT requires the authoritative application transaction"
    end

    entry = @entries.find { |item| item.slot == slot }
    raise UnsafeLedger, "Unknown prepared upload slot" unless entry&.blob&.id
    @attempted[slot] = true

    blob = ActiveStorage::Blob.lock.find(entry.blob.id)
    self.class.verify_owned!(blob, id)
    raise UnsafeLedger, "Upload key was fenced by recovery" unless
      blob.metadata.fetch(LEDGER).fetch("state") == "pending"
    raise UnsafeLedger, "Prepared upload slot changed" unless
      blob.metadata.fetch(LEDGER).fetch("slot") == slot

    @phase = "put"
    self.class.log(id, "put")
    entry.file.tempfile.rewind
    blob.upload_without_unfurling(entry.file.tempfile)
    entry.blob = blob
  rescue BoundaryError, UnsafeLedger
    raise
  rescue StandardError => error
    self.class.log(id, "put", error)
    raise StorageFailure, MESSAGE
  end

  # Exact operation only. A failed PUT may finish remotely after DELETE/HEAD.
  # Preserve unreferenced keys indefinitely as non-uploadable tombstones.
  # Object absence is an observation, not proof that a PUT is terminal.
  def self.recover!(operation_id:)
    raise UnsafeLedger, "Invalid upload operation" unless UUID.match?(operation_id.to_s)
    assert_boundary!
    rows = ActiveStorage::Blob
      .where("key LIKE ?", "#{PREFIX}/#{operation_id}/%")
      .order(:id).limit(MAX_FILES + 1).to_a
    raise UnsafeLedger, "Upload operation exceeded its file bound" if rows.length > MAX_FILES

    result = { deleted: 0, retained: 0, pending: 0, absent: 0 }
    rows.each do |blob|
      begin
        retained = false
        # Commit this fence before external deletion. A storage/database error
        # in the second phase cannot make the key uploadable again.
        blob.with_lock do
          verify_owned!(blob, operation_id)
          retained = referenced?(blob)
          if retained
            mark_state!(blob, "referenced")
          else
            mark_state!(blob, "tombstone", cleanup: {
              "last_attempt_at" => Time.current.utc.iso8601(6), "last_result" => "started"
            })
          end
        end
        if retained
          result[:retained] += 1
          next
        end

        blob.with_lock do
          verify_owned!(blob, operation_id)
          if referenced?(blob)
            mark_state!(blob, "referenced")
            retained = true
          else
            raise UnsafeLedger, "Cleanup fence was lost" unless
              blob.metadata.fetch(LEDGER).fetch("state") == "tombstone"
            log(operation_id, "delete")
            blob.service.delete(blob.key)
            raise StorageFailure, "Object deletion was not confirmed" if blob.service.exist?(blob.key)
            mark_state!(blob, "tombstone", cleanup: {
              "last_result" => "absence_observed", "last_absent_at" => Time.current.utc.iso8601(6)
            })
          end
        end
        result[retained ? :retained : :pending] += 1
      rescue ActiveRecord::RecordNotFound
        result[:absent] += 1
      rescue StandardError => error
        result[:pending] += 1
        log(operation_id, "cleanup_pending", error)
      end
    end
    result
  end
  def self.verify_owned!(blob, operation_id)
    ledger = blob.metadata[LEDGER]
    unless ledger.is_a?(Hash) && ledger["version"] == 1 &&
        ledger["id"] == operation_id && ledger["key"] == blob.key &&
        blob.key.start_with?("#{PREFIX}/#{operation_id}/") &&
        ledger["slot"].to_s.match?(/\A(?:image_\d+|image|brochure|pdf|cover)\z/)
      raise UnsafeLedger, "Upload ledger ownership mismatch"
    end
  end

  def self.referenced?(blob)
    return true if ActiveStorage::Attachment.where(blob_id: blob.id).exists?

    # Be conservative if an existing snapshot retained a signed reference even
    # without an attachment. All application upload writers share the Blob lock.
    token = ActiveRecord::Base.sanitize_sql_like(blob.signed_id)
    pattern = "%#{token}%"
    [Event, Publication].any? do |model|
      model.where(
        "draft_data LIKE :token OR preview_data LIKE :token OR published_data LIKE :token",
        token: pattern
      ).exists?
    end
  end

  def self.assert_boundary!
    connection = ApplicationRecord.connection
    return unless connection.transaction_open?

    # Rails wraps ordinary tests in one non-joinable fixture transaction.
    # Dedicated durability tests disable that wrapper.
    fixture_wrapper = Rails.env.test? && connection.open_transactions == 1 &&
      !connection.current_transaction.joinable?
    return if fixture_wrapper

    raise BoundaryError, "Upload ledger preparation/recovery requires no application transaction"
  end

  def self.mark_state!(blob, state, cleanup: {})
    metadata = blob.metadata.deep_dup
    metadata.fetch(LEDGER)["state"] = state
    metadata.fetch(LEDGER).merge!(cleanup)
    # Avoid Active Storage metadata callbacks and remote COPY operations.
    blob.update_columns(metadata: metadata)
  end

  def self.log(operation_id, phase, error = nil)
    payload = { event: "managed_upload", operation_id: operation_id, phase: phase }
    payload[:exception_class] = error.class.name if error
    Rails.logger.warn(JSON.generate(payload))
  rescue StandardError
    nil
  end

  private

  def validate_files!
    return if errors.any?
    if @entries.length > MAX_FILES
      errors << [:base, "Too many uploaded files."]
      return
    end

    @entries.each do |entry|
      file = entry.file
      unless file.respond_to?(:original_filename) &&
          file.respond_to?(:content_type) && file.respond_to?(:tempfile)
        errors << [error_field(entry.slot), "Choose a supported file from your device."]
        next
      end
      message = entry.validator.call(file)
      errors << [error_field(entry.slot), message] if message
    end
  end

  def register!
    # Build every row and calculate checksums before opening the ledger commit.
    # No object-store request occurs in this phase.
    @entries.each do |entry|
      file = entry.file
      io = file.tempfile
      io.rewind
      scan = UploadScanner.metadata(file).deep_dup
      if UploadScanner.required?
        digest = Digest::SHA256.new
        while (chunk = io.read(64 * 1024))
          digest.update(chunk)
        end
        io.rewind
        unless scan["scan_status"] == "clean" && scan["scan_sha256"] == digest.hexdigest
          raise UnsafeLedger, "Scanned upload bytes changed or scan proof is absent"
        end
      end

      key = "#{PREFIX}/#{id}/#{SecureRandom.hex(24)}"
      metadata = scan.merge("analyzed" => true, LEDGER => {
        "version" => 1, "id" => id, "key" => key, "slot" => entry.slot,
        "prepared_at" => Time.current.utc.iso8601(6), "state" => "pending"
      })
      entry.blob = ActiveStorage::Blob.build_after_unfurling(
        key: key, io: io, filename: file.original_filename,
        content_type: file.content_type, identify: false, metadata: metadata
      )
    end

    ApplicationRecord.transaction do
      @entries.each { |entry| entry.blob.save! }
    end
    self.class.log(id, "ledger_committed")
  end

  def error_field(slot)
    %w[pdf cover image].include?(slot) ? slot.to_sym : :base
  end
end

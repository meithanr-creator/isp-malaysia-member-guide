# Offline fixture boundary tests: no Rails boot, database, storage client or private data.
require "minitest/autorun"
require "minitest/mock"
require "active_support/core_ext/object/deep_dup"
require "json"
require "digest"
require "time"
require "securerandom"
require_relative "../app/services/upload_operation"

class Numeric
  def second = self
end
class FixtureRelation
  include Enumerable
  def initialize(model, rows) = (@model, @rows = model, rows)
  def each(&block) = @rows.each(&block)
  def order(*) = self.class.new(@model, @rows.sort_by(&:id))
  def all = self
  def to_a = @rows.dup
  def exists? = @rows.any?
  def count = @rows.length
  def pluck(key) = @rows.map { |row| row.public_send(key) }
  def where(criteria = nil)
    return self unless criteria
    self.class.new(@model, @rows.select { |row| criteria.all? { |key, value| Array(value).include?(row.public_send(key)) } })
  end
  def not(criteria)
    self.class.new(@model, @rows.reject { |row| criteria.any? { |key, value| Array(value).include?(row.public_send(key)) } })
  end
  def delete_all
    @model.rows -= @rows
    @rows.length
  end
end
class FixtureModel
  class << self
    attr_writer :rows
    def rows = @rows ||= []
    def all = FixtureRelation.new(self, rows)
    def order(*) = all.order(:id)
    def ordered = order(:id)
    def where(criteria = nil) = all.where(criteria)
    def exists? = all.exists?
    def count = rows.length
    def table_name = name.gsub("::", "_").downcase
    def transaction = yield
  end
end
%w[ApplicationRecord User Event Publication ConsultationRequest MembershipImport MembershipRegistryEntry UserSession AccountToken AuthenticationChallenge AccountSecurityEvent AdministrativeAudit MembershipRegistryAudit EventInterest DiscoverSlide MembershipRegistryState LoginAttemptBucket].each { |name| Object.const_set(name, Class.new(FixtureModel)) }
DiscoverSlide.const_set(:DEFAULTS, [])
module ActiveStorage
  Blob = Class.new(FixtureModel)
  Attachment = Class.new(FixtureModel)
  VariantRecord = Class.new(FixtureModel)
end
class FixtureBlob
  attr_accessor :attributes
  def initialize(attributes) = @attributes = attributes
  def id = attributes.fetch("id")
  def key = attributes.fetch("key")
  def filename = attributes.fetch("filename")
  def service_name = attributes.fetch("service_name")
  def metadata = attributes.fetch("metadata")
  def created_at = attributes.fetch("created_at")
  def service = ActiveStorage::Blob.service
end
class SyntheticFixtureStorage
  attr_reader :deleted_keys
  def initialize = @deleted_keys = []
  def delete(key) = @deleted_keys << key
  def exist?(_key) = false
  def client = self
  def list_objects_v2(**) = Struct.new(:contents, :is_truncated).new([], false)
end
class << ActiveStorage::Blob
  attr_accessor :service
end
fixture_source = File.binread(File.expand_path("hosted-acceptance-fixtures.rb", __dir__))
class_source = fixture_source[fixture_source.index("class HostedAcceptanceFixtures")...fixture_source.index("\n  HostedAcceptanceFixtures.new.run!(ARGV)")]
raise "Fixture class extraction failed" unless class_source&.end_with?("end\n")
eval(class_source, TOPLEVEL_BINDING, "hosted-acceptance-fixtures.rb")
APPROVED_PROTECTED_BASELINE = HostedAcceptanceFixtures::PROTECTED_BASELINE.deep_dup.freeze

class ProtectedBaselineFixtureTest < Minitest::Test
  def setup
    @saved_env = ENV.to_h.slice("ISP_ACCEPTANCE_CONTINUATION", "ISP_STAGING_LEASE", "ISP_PRIVATE_ACCEPTANCE")
    ENV["ISP_ACCEPTANCE_CONTINUATION"] = "true"
    ENV["ISP_STAGING_LEASE"] = "rails-private-acceptance"
    ENV["ISP_PRIVATE_ACCEPTANCE"] = "true"
    @klass = HostedAcceptanceFixtures
    (@klass.new.managed_models + [DiscoverSlide, MembershipRegistryState, LoginAttemptBucket]).each { |model| model.rows = [] }
    @fixture = @klass.new
    @time = Time.utc(2026, 10, 28, 1)
    @baseline_rows = [blob(2, "a" * 48), blob(3, "b" * 48)]
    ActiveStorage::Blob.rows = @baseline_rows
    ActiveStorage::Blob.service = nil
    @receipt_raw = JSON.generate("status" => "synthetic_retirement_proof")
    @record = APPROVED_PROTECTED_BASELINE.deep_dup
    @record["blob_rows_sha256"] = digest(@baseline_rows.map(&:attributes))
    @record["source_retirement_result_sha256"] = Digest::SHA256.hexdigest(@receipt_raw)
    @klass.send(:remove_const, :PROTECTED_BASELINE)
    @klass.const_set(:PROTECTED_BASELINE, @record.deep_dup.freeze)
    @packet = { "protected_baseline" => @record.deep_dup }
    @manifest = { "phase" => "active", "run_marker" => "qa-20261028-0123456789ab", "created_at" => @time.iso8601,
      "actors" => {}, "records" => {}, "discover" => { "original" => [], "expected" => [] },
      "registry_state" => { "original" => [], "expected" => [] }, "protected_baseline" => @record.deep_dup,
      "bucket_initially_empty" => true }
    (@klass::CONTENT.keys + @klass::AUXILIARY.keys + %w[blobs interests attachments]).each { |kind| @manifest["records"][kind] = [] }
    @fixture.instance_variable_set(:@m, @manifest)
    @fixture.define_singleton_method(:lock_tables!) {}
    @fixture.define_singleton_method(:save!) { |path, data| }
  end

  def teardown
    %w[ISP_ACCEPTANCE_CONTINUATION ISP_STAGING_LEASE ISP_PRIVATE_ACCEPTANCE].each { |key| ENV.delete(key) }
    @saved_env.each { |key, value| ENV[key] = value }
    @klass.send(:remove_const, :PROTECTED_BASELINE)
    @klass.const_set(:PROTECTED_BASELINE, APPROVED_PROTECTED_BASELINE.deep_dup.freeze)
  end

  def digest(value) = Digest::SHA256.hexdigest(JSON.generate(value))
  def blob(id, suffix, marker: APPROVED_PROTECTED_BASELINE.fetch("source_run_marker"), state: "tombstone", operation: APPROVED_PROTECTED_BASELINE.fetch("upload_operation_id"))
    key = "managed-uploads/#{operation}/#{suffix}"
    FixtureBlob.new("id" => id, "key" => key, "filename" => "#{marker}-image.jpg", "content_type" => "image/jpeg",
      "service_name" => "production_private", "byte_size" => 123, "checksum" => "synthetic-checksum", "created_at" => @time,
      "metadata" => { "scan_status" => "clean", UploadOperation::LEDGER => { "version" => 1, "id" => operation, "key" => key,
        "slot" => "image", "state" => state, "last_result" => "absence_observed" } })
  end

  def with_packet
    stat = Struct.new(:file?, :symlink?).new(true, false)
    reader = ->(path) do
      case path
      when "#{@klass::ROOT}/packet.json" then JSON.generate(@packet)
      when @klass::RETIREMENT_RESULT then @receipt_raw
      else raise "Unexpected local file read"
      end
    end
    File.stub(:lstat, stat) do
      File.stub(:realpath, ->(path) { path }) do
        File.stub(:binread, reader) { yield }
      end
    end
  end
  def assert_refused(&block) = assert_raises(@klass::Refused, &block)

  def test_production_record_pins_exact_retirement_and_two_rows
    assert_equal [2, 3], APPROVED_PROTECTED_BASELINE.fetch("blob_ids")
    assert_equal "ade7fc2601adff2d43055ad939d988f16e4c734b271dfb7ebe9c8413f102cd4a", APPROVED_PROTECTED_BASELINE.fetch("blob_rows_sha256")
    assert_equal "2f5b0af73359219b6ede87d3899b93962378cfa7a5f0817210332c373807ecbc", APPROVED_PROTECTED_BASELINE.fetch("source_retirement_result_sha256")
  end
  def test_exact_baseline_is_verified_and_only_its_rows_are_excluded
    with_packet do
      assert_equal [2, 3], @fixture.verify_protected_baseline!.map(&:id)
      assert @fixture.managed_models_empty?
      extra = blob(41, "c" * 48, marker: @manifest.fetch("run_marker"), state: "referenced", operation: "00000000-0000-4000-8000-000000000041")
      ActiveStorage::Blob.rows << extra
      assert_equal [41], @fixture.run_blobs.pluck(:id)
      refute @fixture.managed_models_empty?
    end
  end
  def test_all_full_row_metadata_is_pinned
    with_packet do
      @baseline_rows.first.attributes["byte_size"] += 1
      assert_refused { @fixture.verify_protected_baseline! }
    end
  end
  def test_missing_protected_row_is_refused
    with_packet do
      ActiveStorage::Blob.rows.pop
      assert_refused { @fixture.verify_protected_baseline! }
    end
  end
  def test_changed_key_or_operation_is_refused
    with_packet do
      @baseline_rows.first.attributes["key"] = "managed-uploads/00000000-0000-4000-8000-000000000001/#{'c' * 48}"
      assert_refused { @fixture.verify_protected_baseline! }
    end
  end
  def test_changed_tombstone_state_is_refused
    with_packet do
      @baseline_rows.first.metadata.fetch(UploadOperation::LEDGER)["state"] = "pending"
      assert_refused { @fixture.verify_protected_baseline! }
    end
  end
  def test_any_protected_attachment_is_refused
    attachment = Struct.new(:id, :blob_id).new(1, 2)
    ActiveStorage::Attachment.rows = [attachment]
    with_packet { assert_refused { @fixture.verify_protected_baseline! } }
  end
  def test_packet_manifest_and_source_proof_must_all_match
    with_packet do
      @packet.fetch("protected_baseline")["blob_ids"] = [2]
      assert_refused { @fixture.verify_protected_baseline! }
      @packet["protected_baseline"] = @record.deep_dup
      @manifest.fetch("protected_baseline")["blob_ids"] = [3]
      assert_refused { @fixture.verify_protected_baseline! }
      @manifest["protected_baseline"] = @record.deep_dup
      @receipt_raw += "\n"
      assert_refused { @fixture.verify_protected_baseline! }
    end
  end
  def test_continuation_flag_cannot_be_silently_disabled_for_bound_manifest
    ENV.delete("ISP_ACCEPTANCE_CONTINUATION")
    assert_refused { @fixture.verify_protected_baseline! }
  end
  def test_legacy_empty_guard_still_sees_every_blob
    ENV.delete("ISP_ACCEPTANCE_CONTINUATION")
    @manifest.delete("protected_baseline")
    assert_equal [2, 3], @fixture.run_blobs.pluck(:id)
    refute @fixture.managed_models_empty?
  end
  def test_continuation_flag_is_restricted_to_native_lease
    ENV["ISP_STAGING_LEASE"] = "rails-staging-3"
    ENV.delete("ISP_PRIVATE_ACCEPTANCE")
    assert_refused { @fixture.guard! }
  end
  def test_other_managed_rows_still_block_empty_baseline
    User.rows = [Struct.new(:id).new(99)]
    with_packet { refute @fixture.managed_models_empty? }
  end
  def test_capture_excludes_protected_rows_from_new_run_and_history
    with_packet do
      @fixture.capture_data!
      assert_empty @manifest.fetch("records").fetch("blobs")
      assert_empty @manifest.fetch("blob_history")
      assert_equal [2, 3], ActiveStorage::Blob.rows.map(&:id)
    end
  end
  def test_capture_refuses_unowned_extra_blob
    ActiveStorage::Blob.rows << blob(41, "c" * 48, marker: "unowned")
    with_packet { assert_refused { @fixture.capture_data! } }
  end
  def test_protected_id_or_key_cannot_enter_deletion_history
    with_packet do
      [ { "id" => 2, "key" => "a" * 28 }, { "id" => 99, "key" => @baseline_rows.first.key } ].each do |poison|
        @manifest["blob_history"] = [poison.merge("filename" => @manifest.fetch("run_marker") + "-synthetic.jpg", "service_name" => "production_private")]
        assert_refused { @fixture.capture_data! }
      end
    end
  end
  def test_new_run_pending_and_tombstone_blobs_still_refuse_cleanup
    with_packet do
      %w[pending tombstone].each do |state|
        ActiveStorage::Blob.rows = @baseline_rows + [blob(41, "c" * 48, marker: @manifest.fetch("run_marker"), state: state, operation: "00000000-0000-4000-8000-000000000041")]
        @fixture.capture_data!
        assert_refused { @fixture.cleanup! }
        assert_equal [2, 3, 41], ActiveStorage::Blob.rows.map(&:id)
      end
    end
  end
  def test_every_entry_stage_rejects_changed_baseline_before_external_calls
    with_packet do
      @baseline_rows.first.attributes["byte_size"] += 1
      %i[setup! capture_data! observations! cleanup!].each do |action|
        assert_refused { @fixture.public_send(action) }
      end
    end
  end
  def test_successful_new_run_cleanup_deletes_only_its_exact_key
    with_packet do
      extra = blob(41, "c" * 48, marker: @manifest.fetch("run_marker"), state: "referenced", operation: "00000000-0000-4000-8000-000000000041")
      ActiveStorage::Blob.rows << extra
      storage = SyntheticFixtureStorage.new
      ActiveStorage::Blob.service = storage
      @fixture.capture_data!
      output, = capture_io { @fixture.cleanup! }
      assert_equal "CLEAN_TO_PROTECTED_BASELINE", JSON.parse(output).fetch("protected_baseline_status")
      assert_equal [extra.key], storage.deleted_keys.uniq
      assert_equal [2, 3], ActiveStorage::Blob.rows.map(&:id)
      assert_equal @record.fetch("blob_rows_sha256"), digest(ActiveStorage::Blob.rows.map(&:attributes))
    end
  end
  def test_baseline_cleanup_and_status_report_retained_rows_without_storage_calls
    with_packet do
      output, = capture_io { @fixture.cleanup! }
      receipt = JSON.parse(output)
      assert_equal "cleaned", receipt.fetch("phase")
      assert_equal "CLEAN_TO_PROTECTED_BASELINE", receipt.fetch("protected_baseline_status")
      assert_equal 2, receipt.fetch("retained_protected_blob_count")
      assert_equal false, receipt.fetch("global_empty_baseline")
      assert_equal 0, receipt.fetch("counts").fetch("blobs")
      assert_equal [2, 3], ActiveStorage::Blob.rows.map(&:id)
      output, = capture_io { @fixture.observations! }
      assert_equal "CLEAN_TO_PROTECTED_BASELINE", JSON.parse(output).fetch("protected_baseline_status")
    end
  end
end

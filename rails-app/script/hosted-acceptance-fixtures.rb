# Operator-only synthetic staging data. No route, demo bypass or real bootstrap.
# Review before execution: Rails runner script/hosted-acceptance-fixtures.rb
# setup | capture-ids | status | cleanup. No command is run by saving this file.
require "json"
require "securerandom"
require "digest"
require "pg"
require "time"

begin
class HostedAcceptanceFixtures
  class Refused < StandardError; end
  ROOT = {
    nil => "D:/Projects/isp-rails-tools/isp-staging-private",
    "rails-staging-2" => "D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-2",
    "rails-staging-3" => "D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-3"
  }.fetch(ENV["ISP_STAGING_LEASE"]) { raise Refused, "Fixture lease refused." }.freeze
  MANIFEST = "#{ROOT}/acceptance-fixtures.json".freeze
  OBSERVATIONS = "#{ROOT}/acceptance-db-observations.json".freeze
  PROJECT = "royal-glitter-45740959".freeze
  ENDPOINT = "https://a9720867333b64a4f8ee70cdfd673eb9.r2.cloudflarestorage.com".freeze
  DOMAIN = "staging.planterapp.co".freeze
  MARKER = /\Aqa-\d{8}-[0-9a-f]{12}\z/
  BLOB_KEY = %r{\A(?:[a-z0-9]{28,128}|managed-uploads/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{48})\z}
  CONTENT = { "events" => Event, "publications" => Publication,
    "consultations" => ConsultationRequest, "imports" => MembershipImport,
    "registry" => MembershipRegistryEntry }.freeze
  def refuse! = raise(Refused, "Fixture operation refused; review the private staging prerequisites.")
  def guard!
    refuse! if ARGV.first != "status" && ENV["ISP_STAGING_LEASE"] != "rails-staging-3"
    refuse! unless Rails.env.production? && ENV["ISP_ACCEPTANCE_FIXTURES"] == "true"
    refuse! unless ENV["ISP_ACCEPTANCE_NEON_PROJECT"] == PROJECT
    refuse! unless ENV["ISP_DEMO_MODE"] == "false"
    refuse! unless %w[ISP_ACCOUNT_EMAILS_ENABLED ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED].all? { |k| ENV[k] == "false" }
    refuse! if ActionMailer::Base.perform_deliveries
    refuse! unless ENV["STORAGE_BUCKET"] == "isp-staging-private" && ENV["STORAGE_ENDPOINT"] == ENDPOINT
    refuse! if File.lstat(ROOT).symlink? || File.realpath(ROOT).tr("\\", "/").downcase != ROOT.downcase
    ActiveRecord::Base.logger = nil
    @db = ActiveRecord::Base.connection
    refuse! unless @db.adapter_name == "PostgreSQL"
    raw = @db.raw_connection
    options = PG::Connection.conninfo_parse(ENV.fetch("DATABASE_URL_UNPOOLED")).to_h { |v| [v[:keyword], v[:val]] }
    host = ENV.fetch("NEON_VERIFY_HOST", "")
    refuse! unless host.match?(/\A[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech\z/) && !host.include?("-pooler.")
    refuse! unless options["host"] == host && options["dbname"].to_s.length.positive? && options["sslmode"] == "verify-full"
    refuse! if %w[hostaddr service options].any? { |k| options[k].to_s.length.positive? }
    info = raw.conninfo_hash
    refuse! unless info[:host].to_s.split(",").any? && info[:host].to_s.split(",").all? { |candidate| candidate == host } && raw.db == options["dbname"] && info[:sslmode] == "verify-full"
    refuse! unless ENV["DB_SSLMODE"] == "verify-full" && raw.server_version / 10_000 == 18
    refuse! unless raw.ssl_in_use? && raw.ssl_attributes["protocol"].to_s.match?(/\ATLSv1\.[23]\z/)
    @target = { "project" => PROJECT, "host" => host, "database" => raw.db }
    @db.execute("SET statement_timeout = '10s'")
    @db.execute("SET lock_timeout = '3s'")
    service = ActiveStorage::Blob.service
    refuse! unless service.is_a?(ActiveStorage::Service::S3Service) && !service.public?
  end
  def private_path!(path)
    refuse! unless [MANIFEST, OBSERVATIONS].include?(path)
    refuse! if File.exist?(path) && File.lstat(path).symlink?
  end
  def save!(path, data)
    private_path!(path)
    temporary = "#{path}.#{SecureRandom.hex(8)}.tmp"
    begin
      File.open(temporary, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |f|
        f.write(JSON.pretty_generate(data) + "\n"); f.flush; f.fsync
      end
      File.rename(temporary, path)
    ensure
      File.unlink(temporary) if File.exist?(temporary)
    end
  end
  def load!
    private_path!(MANIFEST)
    @m = JSON.parse(File.read(MANIFEST))
    refuse! unless @m["version"] == 1 && MARKER.match?(@m["run_marker"].to_s) && @m["target"] == @target
    refuse! if @m.key?("lease_id") && @m["lease_id"] != ENV["ISP_STAGING_LEASE"]
    refuse! if ENV["ISP_STAGING_LEASE"] == "rails-staging-3" && @m["lease_id"] != "rails-staging-3"
    refuse! unless @m["actors"].is_a?(Hash) && @m["records"].is_a?(Hash)
  end
  def ids(kind) = Array(@m.fetch("records").fetch(kind, [])).map { |r| Integer(r.fetch("id")) }
  def actor_ids = @m.fetch("actors").values.map { |r| Integer(r.fetch("id")) }
  def marked?(value) = value.to_s.start_with?("#{@m.fetch('run_marker')} ")
  def own_email?(value)
    value.to_s.match?(/\A#{Regexp.escape(@m.fetch('run_marker'))}-[a-z0-9_-]+@#{Regexp.escape(DOMAIN)}\z/)
  end
  def slide_snapshot(slide)
    slide.attributes.slice("id", "position", "tag", "title", "description", "website_url", "image_alt", "default_image", "lock_version").merge("image_blob_id" => slide.image.blob&.id)
  end
  def stamp = Time.now.utc.iso8601(6)
  def summary(action)
    puts JSON.generate(ok: true, action: action, phase: @m["phase"],
      counts: { actors: actor_ids.length, events: ids("events").length,
        publications: ids("publications").length, consultations: ids("consultations").length,
        imports: ids("imports").length, registry: ids("registry").length, blobs: ids("blobs").length })
  end
  def setup!
    private_path!(MANIFEST)
    refuse! if File.exist?(MANIFEST) || File.symlink?(MANIFEST)
    @m = { "version" => 1, "lease_id" => ENV.fetch("ISP_STAGING_LEASE"), "phase" => "prepared", "run_marker" => "qa-#{Time.now.utc.strftime('%Y%m%d')}-#{SecureRandom.hex(6)}",
      "created_at" => stamp, "target" => @target, "actors" => {}, "records" => {},
      "note" => "Synthetic verification timestamps are constructed fixture state; no mailbox verification or delivery is claimed." }
    (CONTENT.keys + %w[blobs interests]).each { |key| @m["records"][key] = [] }
    ApplicationRecord.transaction do
      @db.execute("LOCK TABLE users, events, publications, consultation_requests, membership_registry_entries, membership_imports IN SHARE ROW EXCLUSIVE MODE")
      refuse! if [User, Event, Publication, ConsultationRequest, MembershipRegistryEntry, MembershipImport].any?(&:exists?)
      # Existing uploaded Discover images may be purged on replacement. Refuse
      # instead of claiming their bytes can be restored from a database snapshot.
      refuse! if DiscoverSlide.any? { |s| s.image.attached? }
      original = DiscoverSlide.ordered.map { |s| slide_snapshot(s) }
      @m["discover"] = { "original" => original, "expected" => original }
      specs = { "member_a" => ["member", "active", true, "eligible"],
        "member_b" => ["member", "active", true, "eligible"],
        "admin_a" => ["admin", "active", true, nil], "admin_b" => ["admin", "active", true, nil],
        "pending" => ["member", "pending", false, "eligible"],
        "suspended" => ["member", "suspended", true, "eligible"],
        "unverified" => ["member", "active", false, "eligible"],
        "ineligible" => ["member", "active", true, "ineligible"],
        "throttle" => ["member", "active", true, "eligible"] }
      specs.each_with_index do |(label, (role, state, verified, eligibility)), index|
        password = SecureRandom.hex(24)
        user = User.create!(name: "#{@m['run_marker']} #{label}", email: "#{@m['run_marker']}-#{label}@#{DOMAIN}",
          password: password, role: role, account_status: state, email_verified_at: verified ? Time.current : nil,
          company: "Synthetic acceptance estate", branch: "Synthetic branch", phone: "")
        actor = user.attributes.slice("id", "email", "role", "created_at").merge("password" => password)
        if eligibility
          entry = MembershipRegistryEntry.create!(user: user, name: user.name, email: user.email,
            member_reference: "000#{index + 1}-#{@m['run_marker']}", status: eligibility)
          actor.merge!("registry_id" => entry.id, "member_reference" => entry.member_reference)
        end
        @m["actors"][label] = actor
      end
      capture_data!
      save!(MANIFEST, @m)
    end
    @m["phase"] = "active"; save!(MANIFEST, @m); summary("setup")
  end
  def recent?(row) = row.created_at >= Time.iso8601(@m.fetch("created_at")) - 1.second
  def verify_actors!
    refuse! unless User.order(:id).pluck(:id) == actor_ids.sort
    @m.fetch("actors").each_value do |a|
      user = User.find(a.fetch("id"))
      refuse! unless recent?(user) && own_email?(user.email) && user.email == a.fetch("email")
    end
  end
  def capture_data!
    verify_actors!
    CONTENT.each do |kind, model|
      rows = model.order(:id).to_a
      rows.each do |row|
        refuse! unless recent?(row)
        case kind
        when "events", "publications"
          refuse! unless marked?(row.draft_data&.fetch("title", nil))
          refuse! if row.published_data && !marked?(row.published_data["title"])
        when "consultations"
          refuse! unless actor_ids.include?(row.user_id) && marked?(row.subject)
        when "imports"
          refuse! unless actor_ids.include?(row.actor_id)
          refuse! unless row.registry_rows.all? { |r| own_email?(r["email"]) }
        when "registry"
          refuse! unless own_email?(row.email) && row.member_reference.start_with?("000") && row.member_reference.include?(@m["run_marker"])
          refuse! if row.user_id && !actor_ids.include?(row.user_id)
        end
      end
      @m["records"][kind] = rows.map { |r| r.attributes.slice("id", "slug", "public_id", "user_id", "actor_id", "email", "member_reference", "created_at") }
    end
    interests = EventInterest.order(:id).to_a
    refuse! unless interests.all? { |r| recent?(r) && actor_ids.include?(r.user_id) && ids("events").include?(r.event_id) }
    @m["records"]["interests"] = interests.map { |r| r.attributes.slice("id", "user_id", "event_id") }
    slides = DiscoverSlide.ordered.to_a
    slides.each do |slide|
      original = @m.fetch("discover").fetch("original").find { |r| r["id"] == slide.id }
      next if original == slide_snapshot(slide)
      defaults = DiscoverSlide::DEFAULTS.find { |r| r[:position] == slide.position }
      shipped = defaults && defaults.all? { |key, value| slide.public_send(key) == value } && !slide.image.attached?
      refuse! unless marked?(slide.title) || (!original && shipped)
    end
    @m["discover"]["expected"] = slides.map { |s| slide_snapshot(s) }
    capture_blobs!(slides.map(&:id))
    @m["captured_at"] = stamp
  end
  def capture_blobs!(slide_ids)
    blobs = ActiveStorage::Blob.order(:id).to_a
    refuse! unless blobs.all? { |b| recent?(b) && b.filename.to_s.start_with?(@m["run_marker"]) }
    blobs.each do |blob|
      match = BLOB_KEY.match(blob.key.to_s)
      refuse! unless match
      UploadOperation.verify_owned!(blob, match[1]) if match[1]
    end
    allowed = { "Event" => ids("events"), "Publication" => ids("publications"), "DiscoverSlide" => slide_ids }
    refuse! unless ActiveStorage::Attachment.all.all? { |a| allowed.fetch(a.record_type, []).include?(a.record_id) }
    @m["records"]["blobs"] = blobs.map { |b| b.attributes.slice("id", "key", "filename", "service_name", "created_at") }
  end
  def file_info(record, snapshot, kind)
    file = snapshot&.fetch(kind, nil)
    return nil unless file.is_a?(Hash)
    blob = ActiveStorage::Blob.find_signed(file["signed_id"].to_s)
    return nil unless blob && record.uploads.blobs.exists?(id: blob.id)
    { id: blob.id, key: blob.key, sha256: blob.metadata["scan_sha256"],
      scan_status: blob.metadata["scan_status"], byte_size: blob.byte_size, content_type: blob.content_type }
  end
  def observations!
    capture_data!
    actors = @m.fetch("actors").to_h do |label, actor|
      u = User.find(actor.fetch("id")); e = u.membership_registry_entry
      fields = u.attributes.slice("id", "name", "email", "role", "account_status", "company", "branch", "phone")
      fields.merge!("verified" => u.email_verified_at.present?, "mfa_enabled" => u.otp_enabled_at.present?, "session_count" => u.user_sessions.count,
        "registry" => e&.attributes&.slice("id", "status", "member_reference"))
      [label, fields]
    end
    events = Event.where(id: ids("events")).order(:id).map do |e|
      e.attributes.slice("id", "slug", "revision", "preview_revision", "published_revision").merge(
        "draft_title" => e.draft_data&.fetch("title", nil), "published_title" => e.published_data&.fetch("title", nil),
        "published_data" => e.published_data,
        "interests" => e.event_interests.order(:id).map { |i| i.attributes.slice("id", "user_id", "name", "email", "company", "event_revision").merge(
          "event_snapshot" => i.event_snapshot, "event_snapshot_sha256" => Digest::SHA256.hexdigest(JSON.generate(i.event_snapshot))) })
    end
    publications = Publication.where(id: ids("publications")).order(:id).map do |p|
      pdf = file_info(p, p.published_data, "pdf"); cover = file_info(p, p.published_data, "cover")
      p.attributes.slice("id", "slug", "revision", "preview_revision", "published_revision").merge(
        "draft_title" => p.draft_data&.fetch("title", nil), "published_title" => p.published_data&.fetch("title", nil),
        "pdf" => pdf, "cover" => cover, "pdf_sha256" => pdf&.fetch(:sha256), "cover_sha256" => cover&.fetch(:sha256))
    end
    save!(OBSERVATIONS, { version: 1, lease_id: ENV["ISP_STAGING_LEASE"], run_marker: @m["run_marker"], captured_at: stamp,
      actors: actors, events: events, publications: publications,
      discover: DiscoverSlide.ordered.map { |s| slide_snapshot(s) },
      consultations: ConsultationRequest.where(id: ids("consultations")).order(:id).map { |r| r.attributes.slice("id", "user_id", "request_key", "category", "subject", "message") },
      counts: CONTENT.to_h { |kind, model| [kind, model.count] }.merge("blobs" => ActiveStorage::Blob.count) })
    summary("status")
  end  # Complete the operator-only runner. These wrappers strengthen the earlier
  # methods without altering application models or exposing a fixture route.
  APPROVED_HOST = "ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech".freeze
  APPROVED_DATABASE = "neondb".freeze
  AUXILIARY = {
    "sessions" => UserSession, "tokens" => AccountToken,
    "challenges" => AuthenticationChallenge,
    "security_events" => AccountSecurityEvent,
    "administrative_audits" => AdministrativeAudit,
    "registry_audits" => MembershipRegistryAudit
  }.freeze

  alias_method :original_guard!, :guard!
  alias_method :original_setup!, :setup!
  alias_method :original_capture_data!, :capture_data!

  def same_json?(left, right)
    JSON.generate(left) == JSON.generate(right)
  end

  def managed_models
    [User, *CONTENT.values, *AUXILIARY.values, EventInterest,
     ActiveStorage::Blob, ActiveStorage::Attachment,
     ActiveStorage::VariantRecord].uniq
  end

  def lock_tables!
    names = [*managed_models.map(&:table_name), DiscoverSlide.table_name,
             MembershipRegistryState.table_name].uniq.sort
    quoted = names.map { |name| @db.quote_table_name(name) }.join(", ")
    @db.execute("LOCK TABLE #{quoted} IN SHARE ROW EXCLUSIVE MODE")
  end

  def default_slide?(slide)
    default = DiscoverSlide::DEFAULTS.find { |row| row[:position] == slide.position }
    default && default.all? { |key, value| slide.public_send(key) == value } &&
      !slide.image.attached?
  end

  def guard!
    refuse! if ARGV.first != "status" && ENV["ISP_STAGING_LEASE"] != "rails-staging-3"
    original_guard!
    raw = @db.raw_connection
    refuse! unless ENV["NEON_VERIFY_HOST"] == APPROVED_HOST
    refuse! unless raw.conninfo_hash[:host].to_s.split(",").any? && raw.conninfo_hash[:host].to_s.split(",").all? { |candidate| candidate == APPROVED_HOST } && raw.db == APPROVED_DATABASE
    refuse! unless ENV["DATABASE_URL"] == ENV["DATABASE_URL_UNPOOLED"]
    service = ActiveStorage::Blob.service
    refuse! unless service.bucket.name == "isp-staging-private"
    refuse! unless service.client.client.config.endpoint.to_s.delete_suffix("/") == ENDPOINT
  end

  def setup!
    listing = ActiveStorage::Blob.service.client.client.list_objects_v2(bucket: "isp-staging-private", max_keys: 1)
    refuse! unless listing.contents.empty? && !listing.is_truncated
    @initial_bucket_empty = true
    ApplicationRecord.transaction do
      lock_tables!
      refuse! if managed_models.any?(&:exists?) || LoginAttemptBucket.exists?
      refuse! unless DiscoverSlide.all.all? { |slide| default_slide?(slide) }
      @initial_registry_state = MembershipRegistryState.order(:id).map(&:attributes)
      refuse! unless MembershipRegistryState.all.all? { |row| row.id == 1 && row.revision == 0 }
      original_setup!
    end
  end

  def capture_data!
    previous = Array(@m.dig("records", "blobs")).deep_dup
    original_capture_data!
    @m["bucket_initially_empty"] = true if @initial_bucket_empty
    history = Array(@m["blob_history"]) + previous + @m.fetch("records").fetch("blobs")
    history.each do |row|
      refuse! unless row["id"].to_i.positive? && BLOB_KEY.match?(row["key"].to_s) &&
        row["filename"].to_s.start_with?(@m.fetch("run_marker")) && row["service_name"] == "production_private"
    end
    grouped = history.group_by { |row| row.fetch("key") }
    refuse! unless grouped.values.all? { |rows| rows.map { |row| row.slice("id", "key", "filename", "service_name") }.uniq.length == 1 }
    @m["blob_history"] = grouped.sort.map { |_key, rows| rows.first }
    refuse! if ActiveStorage::VariantRecord.exists?
    refuse! unless ActiveStorage::Blob.all.all? { |blob| blob.service_name == "production_private" }
    @m["records"]["attachments"] = ActiveStorage::Attachment.order(:id).map do |row|
      row.attributes.slice("id", "blob_id", "record_id", "record_type", "name")
    end
    AUXILIARY.each do |kind, model|
      rows = model.order(:id).to_a
      rows.each do |row|
        timestamp = row.respond_to?(:created_at) ? row.created_at : row.occurred_at
        refuse! unless timestamp && timestamp >= Time.iso8601(@m.fetch("created_at")) - 1.second
        case kind
        when "sessions", "tokens", "challenges"
          refuse! unless actor_ids.include?(row.user_id)
        when "security_events"
          references = [row.user_id, row.actor_id].compact
          refuse! unless references.any? && references.all? { |id| actor_ids.include?(id) }
        when "administrative_audits"
          refuse! unless actor_ids.include?(row.actor_id)
        when "registry_audits"
          refuse! unless actor_ids.include?(row.actor_id) && ids("imports").include?(row.membership_import_id)
          refuse! unless row.eligibility_changes.all? do |change|
            change["member_reference"].to_s.include?(@m.fetch("run_marker"))
          end
        end
      end
      @m["records"][kind] = rows.map do |row|
        row.attributes.slice("id", "user_id", "actor_id", "membership_import_id",
                             "target_type", "target_id", "created_at", "occurred_at")
      end
    end
    state = MembershipRegistryState.order(:id).to_a
    refuse! unless state.all? { |row| row.id == 1 && row.revision >= 0 }
    @m["registry_state"] ||= { "original" => @initial_registry_state || [] }
    original = @m["registry_state"].fetch("original")
    refuse! if original.any? && state.map(&:id) != original.map { |row| row.fetch("id") }
    @m["registry_state"]["expected"] = state.map(&:attributes)
  end

  def checked_capture!
    before = @m.deep_dup
    capture_data!
    refuse! unless same_json?(@m["records"], before["records"])
    refuse! unless same_json?(@m["discover"], before["discover"])
    refuse! unless same_json?(@m["registry_state"], before["registry_state"])
    @m = before
  end

  def restore_discover!
    original = @m.fetch("discover").fetch("original")
    expected = @m.fetch("discover").fetch("expected")
    refuse! unless same_json?(DiscoverSlide.ordered.map { |slide| slide_snapshot(slide) }, expected)
    if original.empty?
      # The only supported introduced slides occupy the shipped default slots.
      refuse! unless expected.length <= DiscoverSlide::DEFAULTS.length
      refuse! unless expected.all? do |row|
        DiscoverSlide::DEFAULTS.any? do |default|
          default[:position] == row["position"] && default[:default_image] == row["default_image"]
        end
      end
      DiscoverSlide.where(id: expected.map { |row| row.fetch("id") }).delete_all
    else
      refuse! unless original.map { |row| row["id"] }.sort == expected.map { |row| row["id"] }.sort
      original.each do |row|
        refuse! unless row["image_blob_id"].nil?
        DiscoverSlide.find(row.fetch("id")).update_columns(row.except("id", "image_blob_id"))
      end
    end
  end

  def restore_registry_state!
    state = @m.fetch("registry_state")
    refuse! unless same_json?(MembershipRegistryState.order(:id).map(&:attributes), state.fetch("expected"))
    original = state.fetch("original")
    if original.empty?
      MembershipRegistryState.where(id: state.fetch("expected").map { |row| row.fetch("id") }).delete_all
    else
      original.each do |row|
        MembershipRegistryState.find(row.fetch("id")).update_columns(row.except("id"))
      end
    end
  end

  def empty_baseline?
    !managed_models.any?(&:exists?) &&
      same_json?(DiscoverSlide.ordered.map { |slide| slide_snapshot(slide) }, @m.fetch("discover").fetch("original")) &&
      same_json?(MembershipRegistryState.order(:id).map(&:attributes), @m.fetch("registry_state").fetch("original"))
  end

  def cleanup!
    refuse! unless %w[prepared active cleanup_started cleaned rolled_back].include?(@m["phase"])
    ApplicationRecord.transaction do
      lock_tables!
      if empty_baseline?
        # Covers rollback after the prepared manifest was saved, and commit
        # succeeding before the final cleaned manifest could be written.
        @m["phase"] = @m["phase"] == "prepared" ? "rolled_back" : "cleaned"
      else
        refuse! if %w[cleaned rolled_back].include?(@m["phase"])
        checked_capture!
        # Never erase the only recovery record for an uncertain late PUT.
        refuse! if ActiveStorage::Blob.where(id: ids("blobs")).any? { |blob|
          %w[pending tombstone].include?(blob.metadata.dig(UploadOperation::LEDGER, "state"))
        }
        @m["phase"] = "cleanup_started"
        save!(MANIFEST, @m)
        # Keep metadata until each exact captured object's deletion is confirmed.
        refuse! unless @m["bucket_initially_empty"] == true
        Array(@m["blob_history"]).each do |row|
          ActiveStorage::Blob.service.delete(row.fetch("key"))
          refuse! if ActiveStorage::Blob.service.exist?(row.fetch("key"))
        end
        listing = ActiveStorage::Blob.service.client.client.list_objects_v2(bucket: "isp-staging-private", max_keys: 1)
        refuse! unless listing.contents.empty? && !listing.is_truncated
        @m["private_bucket_empty_verified_at"] = stamp
        ActiveStorage::Blob.where(id: ids("blobs")).order(:id).each do |blob|
          expected = @m.fetch("records").fetch("blobs").find { |row| row["id"] == blob.id }
          refuse! unless expected && blob.key == expected["key"] &&
            blob.filename.to_s == expected["filename"] && blob.service_name == "production_private"
          blob.service.delete(blob.key)
          refuse! if blob.service.exist?(blob.key)
        end
        # Restore while attachment metadata still preserves the captured snapshot.
        restore_discover!
        restore_registry_state!
        ActiveStorage::Attachment.where(id: ids("attachments"), blob_id: ids("blobs")).delete_all
        refuse! if ActiveStorage::Attachment.where(blob_id: ids("blobs")).exists?
        ActiveStorage::Blob.where(id: ids("blobs")).delete_all
        MembershipRegistryAudit.where(id: ids("registry_audits"), membership_import_id: ids("imports"), actor_id: actor_ids).delete_all
        MembershipImport.where(id: ids("imports"), actor_id: actor_ids).delete_all
        MembershipRegistryEntry.where(id: ids("registry")).delete_all
        UserSession.where(id: ids("sessions"), user_id: actor_ids).delete_all
        AccountToken.where(id: ids("tokens"), user_id: actor_ids).delete_all
        AuthenticationChallenge.where(id: ids("challenges"), user_id: actor_ids).delete_all
        AdministrativeAudit.where(id: ids("administrative_audits"), actor_id: actor_ids).delete_all
        AccountSecurityEvent.where(id: ids("security_events")).delete_all
        EventInterest.where(id: ids("interests"), user_id: actor_ids, event_id: ids("events")).delete_all
        ConsultationRequest.where(id: ids("consultations"), user_id: actor_ids).delete_all
        Event.where(id: ids("events")).delete_all
        Publication.where(id: ids("publications")).delete_all
        User.where(id: actor_ids).delete_all
        refuse! unless empty_baseline?
        @m["phase"] = "cleaned"
      end
    end
    @m["cleaned_at"] = stamp
    save!(MANIFEST, @m)
    summary("cleanup")
  end

  def throttle_observations
    now = Time.current
    @m.fetch("actors").flat_map do |label, actor|
      { "login" => 180, "mfa" => 300, "stepup" => 300, "recovery" => 900 }.map do |purpose, seconds|
        digest = LoginAttemptBucket.send(:scope_digest, "#{purpose}:account", actor.fetch("email"))
        row = LoginAttemptBucket.where(scope_digest: digest).where("expires_at > ?", now)
          .order(window_started_at: :desc).first
        { alias: label, purpose: purpose, attempts: row&.attempts || 0,
          window_started_epoch: row ? row.window_started_at.to_i : (now.to_i / seconds) * seconds }
      end
    end
  end

  def observations!
    if %w[cleaned rolled_back].include?(@m["phase"])
      refuse! unless empty_baseline?
      save!(OBSERVATIONS, { version: 1, lease_id: ENV["ISP_STAGING_LEASE"], run_marker: @m["run_marker"], target: @target,
        phase: @m["phase"], captured_at: stamp, actors: {}, events: [], publications: [],
        consultations: [], imports: [], registry: [], discover: DiscoverSlide.ordered.map { |s| slide_snapshot(s) },
        remaining_throttle_bucket_count: LoginAttemptBucket.count })
      return summary("status")
    end
    refuse! unless %w[prepared active cleanup_started].include?(@m["phase"])
    capture_data!
    now = Time.current
    actors = @m.fetch("actors").to_h do |label, actor|
      user = User.find(actor.fetch("id"))
      sessions = user.user_sessions.order(:id)
      active = sessions.where("expires_at > ? AND last_seen_at > ?", now, now - UserSession::IDLE_TIMEOUT)
      fields = user.attributes.slice("id", "name", "email", "role", "account_status", "company", "branch", "phone")
      fields.merge!("status" => user.account_status, "verified" => user.email_verified_at.present?,
        "mfa_enabled" => user.otp_enabled_at.present?, "session_count" => sessions.count,
        "active_session_count" => active.count, "challenge_count" => user.authentication_challenges.count,
        "usable_challenge_count" => user.authentication_challenges.where(consumed_at: nil).where("expires_at > ?", now).count,
        "sessions" => sessions.map { |s| s.attributes.slice("id", "created_at", "last_seen_at", "expires_at", "mfa_verified_at") },
        "registry" => user.membership_registry_entry&.attributes&.slice("id", "status", "member_reference"))
      [label, fields]
    end
    events = Event.where(id: ids("events")).order(:id).map do |event|
      event.attributes.slice("id", "slug", "revision", "preview_revision", "published_revision", "lock_version").merge(
        "draft_title" => event.draft_data&.fetch("title", nil),
        "published_title" => event.published_data&.fetch("title", nil),
        "draft_data" => event.draft_data, "preview_data" => event.preview_data, "published_data" => event.published_data,
        "interests" => event.event_interests.order(:id).map do |interest|
          interest.attributes.slice("id", "user_id", "name", "email", "company", "event_revision").merge(
            "event_snapshot" => interest.event_snapshot,
            "event_snapshot_sha256" => Digest::SHA256.hexdigest(JSON.generate(interest.event_snapshot)))
        end)
    end
    publications = Publication.where(id: ids("publications")).order(:id).map do |publication|
      pdf = file_info(publication, publication.published_data, "pdf")
      cover = file_info(publication, publication.published_data, "cover")
      publication.attributes.slice("id", "slug", "revision", "preview_revision", "published_revision", "lock_version").merge(
        "draft_title" => publication.draft_data&.fetch("title", nil),
        "published_title" => publication.published_data&.fetch("title", nil),
        "draft_data" => publication.draft_data, "preview_data" => publication.preview_data,
        "published_data" => publication.published_data,
        "pdf" => pdf, "cover" => cover, "pdf_sha256" => pdf&.fetch(:sha256), "cover_sha256" => cover&.fetch(:sha256))
    end
    save!(OBSERVATIONS, { version: 1, lease_id: ENV["ISP_STAGING_LEASE"], run_marker: @m["run_marker"], target: @target, phase: @m["phase"],
      captured_at: stamp, actors: actors, events: events, publications: publications,
      discover: DiscoverSlide.ordered.map { |s| slide_snapshot(s) },
      consultations: ConsultationRequest.where(id: ids("consultations")).order(:id).map { |r| r.attributes.slice("id", "user_id", "request_key", "category", "subject", "message") },
      imports: MembershipImport.where(id: ids("imports")).order(:id).map { |r| r.attributes.slice("id", "public_id", "actor_id", "state", "confirmed_at", "registry_rows", "counts") },
      registry: MembershipRegistryEntry.where(id: ids("registry")).order(:id).map { |r| r.attributes.slice("id", "name", "email", "member_reference", "status", "user_id") },
      # Database observation cannot establish an external SMTP delivery count.
      mail: [{ delivery_count: nil, delivery_count_observable: false,
        pending_outbox_count: AccountToken.where(delivery_status: "pending").count }],
      throttle: throttle_observations,
      counts: CONTENT.to_h { |kind, model| [kind, model.count] }.merge("blobs" => ActiveStorage::Blob.count),
      remaining_throttle_bucket_count: LoginAttemptBucket.count })
    summary("status")
  end

  def summary(action)
    puts JSON.generate(ok: true, action: action, phase: @m["phase"],
      counts: { actors: User.where(id: actor_ids).count,
        events: Event.where(id: ids("events")).count,
        publications: Publication.where(id: ids("publications")).count,
        consultations: ConsultationRequest.where(id: ids("consultations")).count,
        imports: MembershipImport.where(id: ids("imports")).count,
        registry: MembershipRegistryEntry.where(id: ids("registry")).count,
        blobs: ActiveStorage::Blob.where(id: ids("blobs")).count })
  end

  def run!(arguments)
    refuse! unless arguments.length == 1 && %w[setup capture-ids status cleanup].include?(arguments.first)
    guard!
    lock_path = "#{MANIFEST}.lock"
    refuse! if File.symlink?(lock_path)
    File.open(lock_path, File::RDWR | File::CREAT, 0o600) do |lock|
      refuse! unless lock.flock(File::LOCK_EX | File::LOCK_NB)
      begin
        if arguments.first == "setup"
          setup!
        else
          load!
          refuse! unless @m["registry_state"].is_a?(Hash)
          refuse! unless actor_ids.all?(&:positive?) && actor_ids.uniq.length == actor_ids.length
          refuse! unless @m.fetch("records").values.all? do |rows|
            rows.is_a?(Array) && rows.all? { |row| row.is_a?(Hash) && Integer(row.fetch("id")).positive? }
          end
          case arguments.first
          when "capture-ids"
            refuse! unless %w[prepared active].include?(@m["phase"])
            capture_data!
            @m["phase"] = "active"
            save!(MANIFEST, @m)
            summary("capture-ids")
          when "status" then observations!
          when "cleanup" then cleanup!
          end
        end
      ensure
        lock.flock(File::LOCK_UN)
      end
    end
  end
end

  HostedAcceptanceFixtures.new.run!(ARGV)
rescue StandardError => error
  if defined?(HostedAcceptanceFixtures::ROOT)
    File.write("#{HostedAcceptanceFixtures::ROOT}/fixture-last-exception.txt", "#{error.class}: #{error.message}\n#{Array(error.backtrace).first(12).join("\n")}", mode: "w", perm: 0o600)
  end
  # Never print inherited adapter/S3 exceptions or connection configuration.
  warn JSON.generate(ok: false, error: "Fixture operation refused or failed; inspect private state before retrying.")
  exit 1
end

require "csv"
require "stringio"

# CSV bytes live only in bounded request memory. A short-lived database preview
# holds normalized rows; confirmation trusts only those server-held rows.
class MembershipRegistryImporter
  MAX_BYTES = 2.megabytes
  MAX_ROWS = 5_000
  HEADERS = %w[name email member_reference status].freeze
  class InvalidConfirmation < StandardError; end

  def prepare!(upload:, actor:)
    authorize_actor!(actor)
    MembershipImport.expire_previews!
    rows, errors = parse(upload)
    registry = MembershipRegistryState.current
    registry.with_lock do
      errors.concat(classify!(rows)) if errors.empty?
      counts = count_rows(rows, errors)
      digest = digest_rows(rows)
      import = MembershipImport.create!(actor: actor, state: errors.empty? ? "ready" : "invalid",
        registry_rows: rows, validation_errors: errors, counts: counts, digest: digest,
        registry_version: registry.revision, registry_fingerprint: MembershipRegistryState.fingerprint,
        expires_at: Time.current + MembershipImport::PREVIEW_LIFETIME)
      audit!(import, actor, errors.empty? ? "preview" : "preview_rejected")
      import
    end
  end

  def confirm!(import:, actor:, digest:, registry_version:)
    MembershipImport.expire_previews!
    registry = MembershipRegistryState.current
    registry.with_lock do
      # The lock order is shared with invitation/activation: registry, then users.
      User.order(:id).lock.load
      authorize_actor!(actor.reload)
      import.lock!
      raise InvalidConfirmation, "This preview belongs to another administrator." unless import.actor_id == actor.id
      unless exact_confirmation?(import, digest, registry_version)
        raise InvalidConfirmation, "The confirmation did not match this preview. Upload the list again."
      end
      return import if import.confirmed?
      raise InvalidConfirmation, "This preview has expired or contains errors. Upload the list again." unless import.ready?
      unless import.registry_version == registry.revision &&
          ActiveSupport::SecurityUtils.secure_compare(import.registry_fingerprint, MembershipRegistryState.fingerprint)
        raise InvalidConfirmation, "Membership or account records changed after this preview. Upload the list again."
      end
      rows = import.registry_rows.deep_dup
      errors = classify!(rows)
      unless errors.empty? && ActiveSupport::SecurityUtils.secure_compare(import.digest, digest_rows(rows))
        raise InvalidConfirmation, "The reviewed rows are no longer valid. Upload the list again."
      end

      changes = []
      rows.each do |row|
        entry = MembershipRegistryEntry.find_by(member_reference: row.fetch("member_reference")) || MembershipRegistryEntry.new
        previous = entry.persisted? ? entry.status : nil
        entry.assign_attributes(row.slice(*HEADERS))
        entry.save! if entry.new_record? || entry.changed?
        if entry.user && entry.status == "ineligible"
          # User's security callback revokes all existing sessions. Re-eligibility
          # deliberately has no account activation side effect.
          entry.user.update!(account_status: "suspended") unless entry.user.account_status == "suspended"
          entry.user.user_sessions.delete_all
        end
        changes << { "member_reference" => entry.member_reference, "before" => previous, "after" => entry.status,
                     "action" => row.fetch("action") }
      end
      registry.advance!
      import.update!(state: "confirmed", confirmed_at: Time.current, registry_rows: [], validation_errors: [])
      audit!(import, actor, "confirmed", changes: changes)
      import
    end
  rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique, ActiveRecord::StaleObjectError, ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout
    raise InvalidConfirmation, "Membership records changed or could not be saved. Nothing was imported; upload the list again."
  end

  private

  def authorize_actor!(actor)
    raise InvalidConfirmation, "Administrator access is required." unless actor&.admin? && actor.login_allowed?
  end

  def exact_confirmation?(import, digest, registry_version)
    digest.is_a?(String) && digest.match?(/\A[0-9a-f]{64}\z/) &&
      ActiveSupport::SecurityUtils.secure_compare(import.digest, digest) &&
      registry_version.to_s.match?(/\A(?:0|[1-9][0-9]*)\z/) && import.registry_version.to_s == registry_version.to_s
  end

  def parse(upload)
    return [[], ["Choose a UTF-8 CSV file."]] unless upload.respond_to?(:read)
    bytes = upload.read(MAX_BYTES + 1).to_s
    return [[], ["The CSV must be no larger than 2 MB."]] if bytes.bytesize > MAX_BYTES
    data = bytes.dup.force_encoding(Encoding::UTF_8)
    return [[], ["The CSV must contain valid UTF-8 text."]] unless data.valid_encoding?
    return [[], ["The CSV contains unsupported control characters."]] if data.match?(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
    data.delete_prefix!("\uFEFF")
    csv = CSV.new(StringIO.new(data), headers: false, field_size_limit: 2_048)
    return [[], ["Use exactly these CSV headers, in order: #{HEADERS.join(',')}."]] unless csv.shift == HEADERS
    rows = []
    csv.each do |values|
      return [[], ["The CSV must contain no more than 5,000 data rows."]] if rows.length >= MAX_ROWS
      return [[], ["Row #{rows.length + 2} must have exactly four columns."]] unless values.length == HEADERS.length
      row = HEADERS.zip(values.map { |value| value.to_s.strip }).to_h
      row["email"] = row["email"].downcase
      row["row_number"] = rows.length + 2
      row["errors"] = []
      row["action"] = "invalid"
      rows << row
    end
    return [[], ["The CSV must contain at least one membership row."]] if rows.empty?
    [rows, []]
  rescue CSV::MalformedCSVError, ArgumentError, EncodingError
    [[], ["The CSV could not be read. Check quoting, UTF-8 encoding and field lengths."]]
  end

  def classify!(rows)
    entries = MembershipRegistryEntry.all.to_a
    by_email = entries.index_by(&:email)
    by_reference = entries.index_by(&:member_reference)
    users_by_email = User.all.to_a.group_by { |user| user.email.to_s.strip.downcase }
    approved_admin_email = ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"].to_s.strip.downcase
    email_counts = rows.map { |row| row["email"] }.tally
    reference_counts = rows.map { |row| row["member_reference"] }.tally
    errors = []
    rows.each do |row|
      issues = []
      issues << "Name is required and must be 80 characters or fewer." unless row["name"].present? && row["name"].length <= 80
      unless row["email"].present? && row["email"].length <= 160 && row["email"].match?(URI::MailTo::EMAIL_REGEXP)
        issues << "A valid email address of 160 characters or fewer is required."
      end
      unless row["member_reference"].present? && row["member_reference"].length <= 80
        issues << "Membership reference is required and must be 80 characters or fewer."
      end
      issues << "Status must be eligible or ineligible." unless %w[eligible ineligible].include?(row["status"])
      issues << "Fields must be on one line without control characters." if HEADERS.any? { |field| row[field].match?(/[\x00-\x1f\x7f]/) }
      issues << "Email is repeated in this CSV." if row["email"].present? && email_counts[row["email"]] > 1
      issues << "Membership reference is repeated in this CSV." if row["member_reference"].present? && reference_counts[row["member_reference"]] > 1
      email_entry = by_email[row["email"]]
      reference_entry = by_reference[row["member_reference"]]
      if email_entry && email_entry.member_reference != row["member_reference"]
        issues << "Email already belongs to a different membership reference."
      end
      if reference_entry && reference_entry.email != row["email"]
        issues << "Membership reference already belongs to a different email."
      end
      users = users_by_email.fetch(row["email"], [])
      if (approved_admin_email.present? && row["email"] == approved_admin_email) || users.any?(&:admin?)
        issues << "Administrator identities cannot be imported as members."
      elsif users.any? { |user| !reference_entry || reference_entry.user_id != user.id }
        issues << "Email already belongs to an account that is not linked to this membership."
      end
      if reference_entry&.user && (!reference_entry.user.member? || reference_entry.user.email != row["email"])
        issues << "The linked account identity conflicts with this membership."
      end
      row["errors"] = issues
      row["action"] = if issues.any?
        "invalid"
      elsif reference_entry.nil?
        "add"
      elsif HEADERS.any? { |field| reference_entry.public_send(field) != row[field] }
        "update"
      else
        "unchanged"
      end
      # Invalid long fields are bounded in protected previews as well as output.
      HEADERS.each { |field| row[field] = row[field].truncate(180, omission: "…") } if issues.any?
      errors.concat(issues.map { |issue| "Row #{row.fetch('row_number')}: #{issue}" })
    end
    errors
  end

  def count_rows(rows, errors)
    { "total" => rows.length, "add" => rows.count { |row| row["action"] == "add" },
      "update" => rows.count { |row| row["action"] == "update" },
      "unchanged" => rows.count { |row| row["action"] == "unchanged" },
      "invalid" => rows.count { |row| row["action"] == "invalid" }, "errors" => errors.length }
  end

  def digest_rows(rows)
    Digest::SHA256.hexdigest(rows.map { |row| row.slice(*HEADERS, "row_number", "action") }.to_json)
  end

  def audit!(import, actor, action, changes: [])
    MembershipRegistryAudit.create!(membership_import: import, actor: actor, action: action,
      digest: import.digest, counts: import.counts, eligibility_changes: changes, occurred_at: Time.current)
  end
end






require "test_helper"
require "stringio"

class MembershipRegistryImporterTest < ActiveSupport::TestCase
  setup do
    @admin = create_member(role: "admin")
    @service = MembershipRegistryImporter.new
    @previous_bootstrap_email = ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"]
    ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"] = " RESERVED-ADMIN@example.test "
  end

  teardown { ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"] = @previous_bootstrap_email }

  test "preview normalizes email and preserves leading zeros without activating accounts or sending mail" do
    users = User.count
    deliveries = ActionMailer::Base.deliveries.length
    import = prepare([["Fictional Planter", "  PLANTER@example.test ", "000071", "eligible"]])
    assert import.ready?
    assert_equal "planter@example.test", import.registry_rows.first["email"]
    assert_equal "000071", import.registry_rows.first["member_reference"]
    assert_equal 0, MembershipRegistryEntry.count
    assert_equal 1, import.counts["add"]
    confirm(import)
    entry = MembershipRegistryEntry.sole
    assert_equal "000071", entry.member_reference
    assert_nil entry.user_id
    assert_equal users, User.count
    assert_equal deliveries, ActionMailer::Base.deliveries.length
    assert_equal [], import.reload.registry_rows
    audit = import.membership_registry_audits.find_by!(action: "confirmed")
    assert_equal @admin.id, audit.actor_id
    assert_equal [{ "member_reference" => "000071", "before" => nil, "after" => "eligible", "action" => "add" }], audit.eligibility_changes
    refute_includes audit.attributes.to_json, "planter@example.test"
  end

  test "only matching rows change and omitted registry entries are preserved" do
    original = registry(name: "Before")
    omitted = registry(email: "omitted@example.test", member_reference: "0099")
    import = prepare([["After", original.email, original.member_reference, "ineligible"]])
    assert_equal "update", import.registry_rows.first["action"]
    confirm(import)
    assert_equal "After", original.reload.name
    assert_equal "ineligible", original.status
    assert_equal "eligible", omitted.reload.status
    unchanged = prepare([[original.name, original.email, original.member_reference, original.status]])
    assert_equal 1, unchanged.counts["unchanged"]
  end

  test "strict CSV headers reject roles passwords missing duplicate and reordered columns" do
    ["name,email,member_reference,status,role\nA,a@example.test,001,eligible,admin\n",
      "name,email,member_reference,password\nA,a@example.test,001,password\n",
      "name,email,email,status\nA,a@example.test,001,eligible\n",
      "email,name,member_reference,status\na@example.test,A,001,eligible\n"].each do |content|
      import = prepare_text(content)
      assert_equal "invalid", import.state
      assert_match "headers", import.validation_errors.join
      assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    end
    assert_equal 0, MembershipRegistryEntry.count
  end

  test "empty malformed control-character and invalid UTF8 CSVs fail closed" do
    ["", "name,email,member_reference,status\n", "name,email,member_reference,status\n\"unfinished",
      "name,email,member_reference,status\nA,\xff,001,eligible\n".b,
      "name,email,member_reference,status\nA,a@example.test,00\x001,eligible\n"].each do |content|
      import = prepare_text(content)
      assert_equal "invalid", import.state
      assert_empty import.registry_rows
    end
    import = @service.prepare!(upload: nil, actor: @admin)
    assert_equal "invalid", import.state
  end

  test "UTF8 BOM is accepted and a formula-like name remains literal text" do
    import = prepare_text("\uFEFFname,email,member_reference,status\n=2+2,formula@example.test,00005,eligible\n")
    assert import.ready?
    confirm(import)
    assert_equal "=2+2", MembershipRegistryEntry.sole.name
  end

  test "two megabyte and five thousand row limits reject an entire oversized upload" do
    import = prepare_text("x" * (MembershipRegistryImporter::MAX_BYTES + 1))
    assert_equal "invalid", import.state
    assert_match "2 MB", import.validation_errors.join
    lines = ["name,email,member_reference,status"] + 5_001.times.map { |i| "Fictional #{i},member#{i}@example.test,#{i.to_s.rjust(6, '0')},eligible" }
    import = prepare_text(lines.join("\n"))
    assert_equal "invalid", import.state
    assert_match "5,000", import.validation_errors.join
    assert_empty import.registry_rows
  end

  test "invalid rows have bounded fields strict statuses and row-numbered errors" do
    import = prepare([["x" * 200, "bad address", "", "active"], ["Good", "good@example.test", "0008", "eligible"]])
    assert_equal "invalid", import.state
    assert_equal 1, import.counts["invalid"]
    assert_equal 1, import.counts["add"]
    assert import.validation_errors.all? { |error| error.start_with?("Row 2:") }
    assert_operator import.registry_rows.first["name"].length, :<=, 180
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    assert_equal 0, MembershipRegistryEntry.count
  end

  test "duplicate normalized emails and references mark all affected rows invalid" do
    import = prepare([["One", "SAME@example.test", "001", "eligible"], ["Two", "same@example.test", "002", "eligible"], ["Three", "third@example.test", "001", "eligible"]])
    assert_equal 3, import.counts["invalid"]
    assert_match "Email is repeated", import.validation_errors.join
    assert_match "reference is repeated", import.validation_errors.join
  end

  test "existing registry email and reference cannot be reassigned" do
    entry = registry
    [["Different", "different@example.test", entry.member_reference, "eligible"],
      ["Different", entry.email, "99999", "eligible"]].each do |row|
      import = prepare([row])
      assert_equal "invalid", import.state
      assert_match "already belongs", import.validation_errors.join
    end
    assert_equal "member@example.test", entry.reload.email
    assert_equal "0001", entry.member_reference
  end

  test "user administrator and configured bootstrap identity collisions are rejected" do
    member = create_member(email: "existing@example.test")
    [member.email, @admin.email, "reserved-admin@example.test"].each do |email|
      import = prepare([["Fictional", email, "123", "eligible"]])
      assert_equal "invalid", import.state
      assert_match(/account|Administrator/, import.validation_errors.join)
    end
  end

  test "ineligibility suspends a linked member and revokes sessions without reactivation on eligibility" do
    member = create_member(email: "linked@example.test")
    entry = registry(email: member.email, user: member)
    UserSession.issue(member, authenticated_password_digest: member.password_digest)
    assert_equal 1, member.user_sessions.count
    import = prepare([[entry.name, entry.email, entry.member_reference, "ineligible"]])
    confirm(import)
    assert_equal "suspended", member.reload.account_status
    assert_equal 0, member.user_sessions.count
    confirm(prepare([[entry.name, entry.email, entry.member_reference, "eligible"]]))
    assert_equal "eligible", entry.reload.status
    assert_equal "suspended", member.reload.account_status
  end

  test "confirmation requires exact digest and registry version" do
    import = prepare
    [[nil, import.registry_version], ["0" * 64, import.registry_version], [import.digest, nil], [import.digest, "1oops"], [import.digest, import.registry_version + 1]].each do |digest, version|
      assert_raises(MembershipRegistryImporter::InvalidConfirmation) do
        @service.confirm!(import: import, actor: @admin, digest: digest, registry_version: version)
      end
    end
    assert_equal 0, MembershipRegistryEntry.count
    assert import.reload.ready?
  end

  test "another administrator and a suspended or downgraded actor cannot confirm" do
    import = prepare
    other = create_member(role: "admin")
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import, actor: other) }
    @admin.update!(account_status: "suspended")
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    @admin.update!(account_status: "active", role: "member")
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    assert_equal 0, MembershipRegistryEntry.count
  end

  test "expired previews erase private row data and cannot be confirmed" do
    import = prepare
    travel_to import.expires_at + 1.second do
      assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
      assert_equal "expired", import.reload.state
      assert_empty import.registry_rows
    end
  end

  test "a second preview is stale after another import and confirmed replay is idempotent" do
    first = prepare
    second = prepare
    confirm(first)
    revision = MembershipRegistryState.current.revision
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(second) }
    assert_no_difference(["MembershipRegistryEntry.count", "MembershipRegistryAudit.count"]) { confirm(first) }
    assert_equal revision, MembershipRegistryState.current.revision
    assert_equal 1, first.membership_registry_audits.where(action: "confirmed").count
  end

  test "registry changes and account creation after preview invalidate confirmation" do
    import = prepare
    registry(email: "outside@example.test", member_reference: "00008")
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    import = prepare
    create_member(email: "new-account@example.test")
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    assert_equal 1, MembershipRegistryEntry.count
  end

  test "server-held rows cannot be changed without invalidating the reviewed digest" do
    import = prepare
    altered = import.registry_rows.deep_dup
    altered.first["name"] = "Unreviewed replacement"
    import.update!(registry_rows: altered)
    assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    assert_equal 0, MembershipRegistryEntry.count
  end

  test "a failed final audit rolls back rows account suspensions and import state together" do
    member = create_member(email: "rollback@example.test")
    entry = registry(email: member.email, user: member)
    UserSession.issue(member, authenticated_password_digest: member.password_digest)
    import = prepare([["Suspended change", entry.email, entry.member_reference, "ineligible"], ["New Fictional", "new@example.test", "9999", "eligible"]])
    revision = MembershipRegistryState.current.revision
    original_create = MembershipRegistryAudit.method(:create!)
    begin
      MembershipRegistryAudit.define_singleton_method(:create!) { |*| raise ActiveRecord::RecordInvalid.new(MembershipRegistryEntry.new) }
      assert_raises(MembershipRegistryImporter::InvalidConfirmation) { confirm(import) }
    ensure
      MembershipRegistryAudit.define_singleton_method(:create!, original_create)
    end
    assert_equal 1, MembershipRegistryEntry.count
    assert_equal "eligible", entry.reload.status
    assert_equal "active", member.reload.account_status
    assert_equal 1, member.user_sessions.count
    assert_equal "ready", import.reload.state
    assert_equal revision, MembershipRegistryState.current.revision
    assert_equal 0, import.membership_registry_audits.where(action: "confirmed").count
  end

  private

  def registry(**overrides)
    MembershipRegistryEntry.create!({ name: "Fictional Member", email: "member@example.test", member_reference: "0001", status: "eligible" }.merge(overrides))
  end

  def prepare(rows = [["Fictional Planter", "new-planter@example.test", "000071", "eligible"]])
    prepare_text(CSV.generate { |csv| csv << MembershipRegistryImporter::HEADERS; rows.each { |row| csv << row } })
  end

  def prepare_text(content)
    @service.prepare!(upload: StringIO.new(content), actor: @admin)
  end

  def confirm(import, actor: @admin)
    @service.confirm!(import: import, actor: actor, digest: import.digest, registry_version: import.registry_version)
  end
end





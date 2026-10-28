require "test_helper"

class MembershipImportJourneyTest < ActionDispatch::IntegrationTest
  setup { @admin = create_member(role: "admin") }
  teardown { close_discover_uploads }

  test "visitors and members cannot read registry previews or import" do
    get admin_membership_registry_entries_path
    assert_redirected_to login_path
    assert_no_difference("MembershipImport.count") { upload_csv }
    assert_redirected_to login_path
    sign_in(create_member)
    get new_admin_membership_import_path
    assert_response :forbidden
    assert_no_difference("MembershipImport.count") { upload_csv }
    assert_response :forbidden
  end

  test "admin upload preview and exact confirmation are private and never create accounts or send mail" do
    sign_in
    get new_admin_membership_import_path
    assert_response :success
    assert_select "input[type=file][name='membership_import[csv]']", count: 1
    users = User.count
    deliveries = ActionMailer::Base.deliveries.length
    upload_csv
    import = MembershipImport.order(:id).last
    assert_redirected_to admin_membership_import_path(import)
    assert_equal 0, MembershipRegistryEntry.count
    follow_redirect!
    assert_response :success
    assert_includes response.headers["Cache-Control"], "no-store"
    assert_select "input[name=digest][value=?]", import.digest
    assert_select "input[name=registry_version][value=?]", import.registry_version.to_s
    assert_select ".membership-details dd", text: "000077"
    assert_select "input[name=role]", count: 0
    post confirm_admin_membership_import_path(import), params: { digest: import.digest, registry_version: import.registry_version, role: "admin", account_status: "active" }
    assert_redirected_to admin_membership_import_path(import)
    assert_equal "confirmed", import.reload.state
    assert_equal "000077", MembershipRegistryEntry.sole.member_reference
    assert_equal users, User.count
    assert_equal deliveries, ActionMailer::Base.deliveries.length
    assert_no_difference(["MembershipRegistryEntry.count", "MembershipRegistryAudit.count"]) do
      post confirm_admin_membership_import_path(import), params: { digest: import.digest, registry_version: import.registry_version }
    end
    get admin_membership_registry_entries_path
    assert_response :success
    assert_select ".membership-row h2", text: "Fictional Planter"
  end

  test "invalid preview escapes row content and has no confirm form" do
    sign_in
    upload_csv("name,email,member_reference,status\n<script>alert(1)</script>,bad-address,000077,active\n")
    follow_redirect!
    assert_response :success
    assert_select ".membership-row script", count: 0
    assert_includes response.body, "&lt;script&gt;"
    assert_select "form[action$='/confirm']", count: 0
    assert_select ".validation-errors", count: 1
    assert_equal 0, MembershipRegistryEntry.count
  end

  test "an administrator cannot read or confirm another administrator's preview" do
    sign_in
    upload_csv
    import = MembershipImport.order(:id).last
    delete session_path
    sign_in(create_member(role: "admin"))
    get admin_membership_import_path(import)
    assert_response :not_found
    assert_no_difference("MembershipRegistryEntry.count") do
      post confirm_admin_membership_import_path(import), params: { digest: import.digest, registry_version: import.registry_version }
    end
    assert_response :not_found
  end

  test "stale administrator session cannot confirm after account suspension" do
    sign_in
    upload_csv
    import = MembershipImport.order(:id).last
    cookie = cookies["_isp_member_rails_session"]
    @admin.update!(account_status: "suspended")
    cookies["_isp_member_rails_session"] = cookie if cookie
    assert_no_difference("MembershipRegistryEntry.count") do
      post confirm_admin_membership_import_path(import), params: { digest: import.digest, registry_version: import.registry_version }
    end
    assert_redirected_to login_path
    assert_equal "ready", import.reload.state
  end

  test "tokenless upload and confirm requests are refused by CSRF protection" do
    sign_in
    upload_csv
    import = MembershipImport.order(:id).last
    previous = ApplicationController.allow_forgery_protection
    ApplicationController.allow_forgery_protection = true
    assert_no_difference("MembershipImport.count") { upload_csv }
    assert_response :unprocessable_entity
    assert_no_difference("MembershipRegistryEntry.count") do
      post confirm_admin_membership_import_path(import), params: { digest: import.digest, registry_version: import.registry_version }
    end
    assert_response :unprocessable_entity
  ensure
    ApplicationController.allow_forgery_protection = previous
  end

  test "malformed upload shape and missing file get a private invalid preview" do
    sign_in
    [nil, "invalid shape", {}].each do |shape|
      post admin_membership_imports_path, params: { membership_import: shape }
      assert_response :redirect
      import = MembershipImport.order(:id).last
      assert_equal "invalid", import.state
      assert_equal 0, import.counts["total"]
    end
  end

  test "membership page shows only the signed-in member's linked reference and hides missing links" do
    member = create_member(email: "own-reference@example.test")
    other = create_member(email: "other-reference@example.test")
    MembershipRegistryEntry.create!(name: other.name, email: other.email, member_reference: "000222", status: "eligible", user: other)
    sign_in(member)
    get member_membership_path
    assert_response :success
    assert_select ".profile-details dt", text: "Membership reference", count: 0
    MembershipRegistryEntry.create!(name: member.name, email: member.email, member_reference: "000111", status: "eligible", user: member)
    get member_membership_path, params: { user_id: other.id }
    assert_response :success
    assert_select ".profile-details dd", text: "000111", count: 1
    assert_select ".profile-details dd", text: "000222", count: 0
    assert_select "input[name*=member_reference]", count: 0
  end
  private

  def sign_in(user = @admin)
    post session_path, params: { email: user.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
  end

  def upload_csv(content = "name,email,member_reference,status\nFictional Planter,PLANTER@example.test,000077,eligible\n")
    post admin_membership_imports_path, params: { membership_import: { csv: discover_upload(content: content, filename: "fictional-members.csv", type: "text/csv") } }
  end
end


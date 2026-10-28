require "test_helper"

class UserTest < ActiveSupport::TestCase
  test "email normalization supports password authentication" do
    member = create_member(email: " ALEX@EXAMPLE.TEST ")
    assert_equal "alex@example.test", member.reload.email
    assert member.authenticate("test-password-2026")
    assert_not member.authenticate("wrong-password")
  end

  test "only supported roles and account states can be persisted" do
    user = User.new(member_attributes(role: "owner", account_status: "invented"))
    assert_not user.valid?
    assert user.errors[:role].present?
    assert user.errors[:account_status].present?
  end

  test "normalized duplicate email is rejected" do
    create_member(email: "alex@example.test")
    duplicate = User.new(member_attributes(email: " ALEX@EXAMPLE.TEST "))
    assert_not duplicate.valid?
    assert duplicate.errors[:email].present?
  end

  test "new accounts are pending until explicitly activated" do
    user = User.create!(member_attributes.except(:account_status))
    assert_equal "pending", user.account_status
    assert_nil User.authenticate_credentials(user.email, "test-password-2026")
    user.update!(account_status: "active")
    assert_equal user, User.authenticate_credentials(user.email.upcase, "test-password-2026")
    user.update!(account_status: "suspended")
    assert_nil User.authenticate_credentials(user.email, "test-password-2026")
  end

  test "production refuses sample identities even when active" do
    %w[member@example.com admin@example.com member@example.net member@example.org member@fixture.test].each do |email|
      user = create_member(email: email)
      assert user.login_allowed?(production: false)
      assert_not user.login_allowed?(production: true)
    end
    verified = create_member(email: "member@approved-mail.my", email_verified_at: Time.current)
    assert_not verified.login_allowed?(production: true)
    MembershipRegistryEntry.create!(name: verified.name, email: verified.email, member_reference: "VERIFIED-001", status: "eligible", user: verified)
    assert verified.reload.login_allowed?(production: true)
  end

  test "password role email and account changes remove all existing sessions" do
    user = create_member
    [ { password: "a-new-password-2026", password_confirmation: "a-new-password-2026" },
      { role: "admin" }, { email: "changed@example.test" }, { account_status: "suspended" } ].each do |change|
      assert UserSession.issue(user, authenticated_password_digest: user.password_digest)
      assert UserSession.issue(user, authenticated_password_digest: user.password_digest)
      assert_equal 2, user.user_sessions.count
      user.update!(change)
      assert_equal 0, user.user_sessions.count
    end
  end

  test "permitted profile changes keep the authenticated sessions" do
    user = create_member
    UserSession.issue(user, authenticated_password_digest: user.password_digest)
    user.update!(name: "Updated Sample", company: "Updated Company")
    assert_equal 1, user.user_sessions.count
  end

  test "unknown addresses and incorrect passwords both fail authentication" do
    user = create_member
    assert_nil User.authenticate_credentials("unknown@example.test", "incorrect")
    assert_nil User.authenticate_credentials(user.email, "incorrect")
  end
end

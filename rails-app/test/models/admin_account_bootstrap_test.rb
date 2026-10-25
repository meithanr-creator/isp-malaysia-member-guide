require "test_helper"

class AdminAccountBootstrapTest < ActiveSupport::TestCase
  setup do
    @previous_environment = Rails.env
    @previous_approved = ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"]
    @previous_email_flag = ENV["ISP_ACCOUNT_EMAILS_ENABLED"]
    @approved = "bootstrap@approved-mail.my"
    ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"] = @approved
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] = "true"
  end
  teardown do
    Rails.env = @previous_environment
    ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"] = @previous_approved
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] = @previous_email_flag
  end

  test "bootstrap is rejected outside production or without matching approval" do
    assert_raises(ArgumentError) { AdminAccountBootstrap.call(email: @approved, confirmation: @approved) }
    Rails.env = "production"
    assert_raises(ArgumentError) { AdminAccountBootstrap.call(email: @approved, confirmation: "different") }
    assert_equal 0, User.where(role: "admin").count
  end

  test "approved bootstrap creates only a pending administrator without exposing a password" do
    Rails.env = "production"
    token = nil
    assert AdminAccountBootstrap.call(email: @approved, confirmation: @approved, deliver: ->(record) { token = record.delivery_token })
    admin = User.find_by!(email: @approved)
    assert_equal "admin", admin.role
    assert_equal "pending", admin.account_status
    assert_nil admin.email_verified_at
    assert_not admin.login_allowed?
    record = AccountToken.lookup(token, purpose: "activation")
    assert record.usable?
    assert_nil record.delivery_token
    assert_equal 0, admin.user_sessions.count
  end

  test "another administrator prevents bootstrap and delivery failure revokes the link" do
    Rails.env = "production"
    assert_not AdminAccountBootstrap.call(email: @approved, confirmation: @approved, deliver: ->(_record) { raise IOError, "unavailable" })
    admin = User.find_by!(email: @approved)
    assert_equal "pending", admin.account_status
    assert_equal "failed", admin.account_tokens.last.delivery_status
    assert admin.account_tokens.last.consumed_at
    admin.update!(account_status: "active", email_verified_at: Time.current)
    assert_raises(ArgumentError) { AdminAccountBootstrap.call(email: @approved, confirmation: @approved, deliver: ->(_record) {}) }
  end
end

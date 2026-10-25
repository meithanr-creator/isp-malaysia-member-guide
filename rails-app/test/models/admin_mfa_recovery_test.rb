require "test_helper"

class AdminMfaRecoveryTest < ActiveSupport::TestCase
  setup do
    @previous_environment = Rails.env
    @previous_approved = ENV["ISP_MFA_RECOVERY_ADMIN_EMAIL"]
    @previous_mail = ENV["ISP_ACCOUNT_EMAILS_ENABLED"]
    @admin = create_member(role: "admin", email: "recovery-admin@approved-mail.my", email_verified_at: Time.current,
      otp_secret: ROTP::Base32.random_base32, otp_enabled_at: Time.current,
      recovery_code_digests: [Digest::SHA256.hexdigest("OLD-RECOVERY-CODE")])
    ENV["ISP_MFA_RECOVERY_ADMIN_EMAIL"] = @admin.email
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] = "true"
    Rails.env = "production"
  end
  teardown do
    Rails.env = @previous_environment
    ENV["ISP_MFA_RECOVERY_ADMIN_EMAIL"] = @previous_approved
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] = @previous_mail
  end

  test "host recovery revokes every old factor credential and returns only pending state" do
    session = UserSession.issue(@admin, authenticated_password_digest: @admin.password_digest, mfa_verified: true)
    challenge, = AuthenticationChallenge.issue(@admin, authenticated_password_digest: @admin.password_digest)
    token, = AccountToken.issue(@admin, purpose: "recovery")
    old_password = @admin.password_digest
    assert reset
    @admin.reload
    assert_equal "pending", @admin.account_status
    assert_equal "admin", @admin.role
    assert_nil @admin.email_verified_at
    assert_nil @admin.otp_secret
    assert_nil @admin.otp_enabled_at
    assert_empty @admin.recovery_code_digests
    assert_not_equal old_password, @admin.password_digest
    assert_not @admin.authenticate("test-password-2026")
    assert_nil UserSession.resume(session.last)
    assert_empty @admin.user_sessions
    assert challenge.reload.consumed_at
    assert_nil challenge.otp_secret
    assert token.reload.consumed_at
    assert_nil token.delivery_token
    assert_not @admin.login_allowed?
    audit = AccountSecurityEvent.find_by!(user: @admin, action: "operator_mfa_reset")
    assert_equal "INC-LOCAL-001", audit.authorization_reference
    assert_equal "hosting-operator-01", audit.operator_reference
    assert_equal "pending_reactivation", audit.outcome
  end

  test "missing approval reference confirmation and wrong role reject without changes" do
    original = @admin.authentication_fingerprint
    assert_raises(ArgumentError) { reset(authorization_reference: "") }
    assert_raises(ArgumentError) { reset(confirmation: "incorrect") }
    ENV["ISP_MFA_RECOVERY_ADMIN_EMAIL"] = "other@approved-mail.my"
    assert_raises(ArgumentError) { reset }
    assert_equal original, @admin.reload.authentication_fingerprint
    assert_equal "active", @admin.account_status
  end

  test "separate reactivation requires matching reset audit and preserves MFA gate" do
    assert_raises(ArgumentError) { reactivate(deliver: ->(_record) {}) }
    reset
    assert_raises(ArgumentError) { reactivate(authorization_reference: "INC-OTHER-001", deliver: ->(_record) {}) }
    raw = nil
    assert reactivate(deliver: ->(record) { raw = record.delivery_token })
    result = AccountTokenConsumer.call(token: raw, purpose: "activation", password: "recovered-admin-password", password_confirmation: "recovered-admin-password")
    assert result.success?, result.error
    assert_equal "active", @admin.reload.account_status
    assert @admin.email_verified_at
    assert_nil @admin.otp_enabled_at
    assert_nil UserSession.issue(@admin, authenticated_password_digest: @admin.password_digest, mfa_verified: true)
    assert AuthenticationChallenge.issue(@admin, authenticated_password_digest: @admin.password_digest)
    assert_empty @admin.user_sessions
  end

  test "failed reactivation sends leave pending and revoke the link" do
    reset
    assert_not reactivate(deliver: ->(_record) { raise IOError, "unavailable" })
    record = @admin.account_tokens.last
    assert_equal "failed", record.delivery_status
    assert record.consumed_at
    assert_nil record.delivery_token
    assert_equal "pending", @admin.reload.account_status
    assert_empty @admin.user_sessions
  end

  private

  def options
    { user: @admin, confirmation: "RESET ADMIN MFA #{@admin.id}", authorization_reference: "INC-LOCAL-001", operator_reference: "hosting-operator-01" }
  end
  def reset(**overrides) = AdminMfaRecovery.call(**options.merge(overrides))
  def reactivate(**overrides) = AdminMfaRecovery.send_reactivation(**options.merge(overrides))
end

# Host-operator only, after documented two-channel human authorization. No route.
class AdminMfaRecovery
  REFERENCE = /\A[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}\z/

  def self.call(user:, confirmation:, authorization_reference:, operator_reference:)
    authorize!(user, confirmation, authorization_reference, operator_reference)
    registry = MembershipRegistryState.current
    registry.with_lock do
      user.with_lock do
        authorize!(user, confirmation, authorization_reference, operator_reference)
        user.update!(account_status: "pending", password: SecureRandom.hex(32), password_confirmation: nil,
          email_verified_at: nil, otp_secret: nil, otp_enabled_at: nil, otp_last_used_at: nil, recovery_code_digests: [])
        user.user_sessions.delete_all
        user.authentication_challenges.update_all(consumed_at: Time.current, otp_secret: nil, recovery_codes: nil)
        user.account_tokens.update_all(consumed_at: Time.current, delivery_token: nil)
        registry.advance!
        audit!(user, "pending_reactivation", authorization_reference, operator_reference)
      end
    end
    true
  end

  # Separate, explicitly invoked delivery; resetting MFA never emails by itself.
  def self.send_reactivation(user:, confirmation:, authorization_reference:, operator_reference:,
    deliver: ->(record) { AccountMailer.activation(record.id).deliver_now })
    authorize!(user, confirmation, authorization_reference, operator_reference)
    raise ArgumentError, "Account email delivery is disabled." unless AccountMailer.enabled?
    record = nil
    registry = MembershipRegistryState.current
    registry.with_lock do
      user.with_lock do
        authorize!(user, confirmation, authorization_reference, operator_reference)
        reset = AccountSecurityEvent.where(user: user, action: "operator_mfa_reset").order(:id).last
        unless user.account_status == "pending" && user.email_verified_at.nil? && user.otp_enabled_at.nil? &&
            reset&.authorization_reference == authorization_reference && reset&.operator_reference == operator_reference
          raise ArgumentError, "A matching authorized MFA reset is required before reactivation delivery."
        end
        record, = AccountToken.issue(user, purpose: "activation")
      end
    end
    begin
      deliver.call(record)
      record.update!(delivery_status: "sent", delivery_token: nil)
      audit!(user, "reactivation_sent", authorization_reference, operator_reference, action: "operator_mfa_reactivation")
      true
    rescue StandardError
      record.update!(delivery_status: "failed", consumed_at: Time.current, delivery_token: nil)
      audit!(user, "delivery_failed", authorization_reference, operator_reference, action: "operator_mfa_reactivation")
      false
    end
  end

  def self.authorize!(user, confirmation, authorization_reference, operator_reference)
    approved = ENV["ISP_MFA_RECOVERY_ADMIN_EMAIL"].to_s.strip.downcase
    valid = Rails.env.production? && user.persisted? && user.admin? && !user.sample_identity? &&
      approved.present? && user.email == approved && confirmation == "RESET ADMIN MFA #{user.id}" &&
      REFERENCE.match?(authorization_reference.to_s) && REFERENCE.match?(operator_reference.to_s)
    raise ArgumentError, "Approved administrator, operator authorization reference and exact reset confirmation are required." unless valid
  end
  private_class_method :authorize!

  def self.audit!(user, outcome, authorization_reference, operator_reference, action: "operator_mfa_reset")
    AccountSecurityEvent.create!(user: user, action: action, outcome: outcome,
      authorization_reference: authorization_reference, operator_reference: operator_reference)
  end
  private_class_method :audit!
end

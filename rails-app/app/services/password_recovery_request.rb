class PasswordRecoveryRequest
  def self.call(email:)
    return unless AccountMailer.enabled?
    normalized = email.to_s.strip.downcase
    return if normalized.length > 160
    user = User.find_by(email: normalized)
    return unless user
    user.with_lock do
      return unless user.password_login_allowed?
      record, = AccountToken.issue(user, purpose: "recovery")
      record.update!(delivery_status: "queued")
      AccountSecurityEvent.create!(user: user, action: "recovery_email", outcome: "queued")
    end
    nil
  end
end

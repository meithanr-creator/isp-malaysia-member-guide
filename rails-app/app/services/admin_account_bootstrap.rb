# Operator-only entry point. Never called by a web route or CSV import.
class AdminAccountBootstrap
  def self.call(email:, confirmation:, deliver: ->(record) { AccountMailer.activation(record.id).deliver_now })
    approved = ENV["ISP_BOOTSTRAP_ADMIN_EMAIL"].to_s.strip.downcase
    unless Rails.env.production? && approved.present? && email == approved && confirmation == approved && AccountMailer.enabled?
      raise ArgumentError, "Production, approved email confirmation and enabled account delivery are required."
    end
    record = user = nil
    registry = MembershipRegistryState.current
    registry.with_lock do
      existing = User.where(role: "admin")
      user = existing.find_by(email: approved)
      raise ArgumentError, "An administrator is already provisioned; use the designated recovery process." if existing.where.not(id: user&.id).exists? || (user && user.account_status != "pending")
      raise ArgumentError, "The approved email belongs to another account." if User.where(email: approved).where.not(id: user&.id).exists?
      user ||= User.create!(name: "ISP Administrator", email: approved, role: "admin", account_status: "pending", password: SecureRandom.hex(32))
      raise ArgumentError, "A sample identity cannot be provisioned in production." if user.sample_identity?
      record, = AccountToken.issue(user, purpose: "activation")
      registry.advance!
      AccountSecurityEvent.create!(user: user, action: "administrator_bootstrap", outcome: "pending")
    end
    begin
      deliver.call(record)
      record.update!(delivery_status: "sent", delivery_token: nil)
      AccountSecurityEvent.create!(user: user, action: "administrator_bootstrap", outcome: "sent")
      true
    rescue StandardError
      record.update!(delivery_status: "failed", consumed_at: Time.current, delivery_token: nil)
      AccountSecurityEvent.create!(user: user, action: "administrator_bootstrap", outcome: "delivery_failed")
      false
    end
  end
end

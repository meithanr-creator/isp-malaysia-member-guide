class User < ApplicationRecord
  has_secure_password reset_token: false
  encrypts :otp_secret
  serialize :recovery_code_digests, coder: JSON, type: Array
  has_one :membership_registry_entry, dependent: :nullify
  has_many :user_sessions, dependent: :delete_all
  has_many :account_tokens, dependent: :delete_all
  has_many :authentication_challenges, dependent: :delete_all
  has_many :event_interests, dependent: :destroy
  has_many :consultation_requests, dependent: :restrict_with_error
  has_many :interested_events, through: :event_interests, source: :event
  normalizes :email, with: ->(email) { email.strip.downcase }
  validates :name, :email, presence: true
  validates :email, uniqueness: true, format: { with: URI::MailTo::EMAIL_REGEXP }, length: { maximum: 160 }
  validates :role, inclusion: { in: %w[member admin] }
  validates :account_status, inclusion: { in: %w[pending active suspended] }
  validates :password, length: { minimum: 12 }, allow_nil: true
  validates :name, length: { maximum: 80 }
  validates :company, length: { maximum: 120 }
  validates :branch, length: { maximum: 100 }
  validates :phone, length: { maximum: 40 }
  after_update :revoke_sessions_after_security_change

  # An active flag alone does not establish membership or control of an email.
  def password_login_allowed?(production: Rails.env.production?)
    return false unless account_status == "active"
    return true unless production
    return false if sample_identity? || email_verified_at.nil?
    return true if admin?
    entry = membership_registry_entry
    entry&.eligible? && entry.email == email
  end

  def login_allowed?(production: Rails.env.production?)
    password_login_allowed?(production: production) && (!admin_mfa_required?(production: production) || otp_enabled_at.present?)
  end

  def admin_mfa_required?(production: Rails.env.production?)
    admin? && (production || ENV["ISP_REQUIRE_ADMIN_MFA"] == "true")
  end

  def sample_identity?
    domain = email.to_s.split("@").last.to_s.downcase
    %w[example.com example.net example.org].include?(domain) || domain.end_with?(".test", ".invalid", ".localhost")
  end

  def authentication_fingerprint
    Digest::SHA256.hexdigest([email, password_digest, role, account_status, email_verified_at&.iso8601(6),
      otp_secret, otp_enabled_at&.iso8601(6), recovery_code_digests].to_json)
  end

  def revoke_sessions!
    with_lock { user_sessions.delete_all }
  end

  def self.authenticate_credentials(email, password)
    normalized = email.to_s.strip.downcase
    return if normalized.length > 160 || password.to_s.bytesize > 72
    user = find_by(email: normalized)
    candidate = user || new(password_digest: dummy_password_digest)
    authenticated = candidate.authenticate(password.to_s)
    user if authenticated && user&.password_login_allowed?
  end

  def self.dummy_password_digest
    @dummy_password_digest ||= new(password: SecureRandom.hex(32)).password_digest
  end
  private_class_method :dummy_password_digest

  def admin? = role == "admin"
  def member? = role == "member"

  private

  def revoke_sessions_after_security_change
    changes = saved_changes.keys & %w[email password_digest role account_status email_verified_at otp_secret otp_enabled_at recovery_code_digests]
    if changes.any?
      user_sessions.delete_all
      AccountSecurityEvent.create!(user: self, action: "credentials_changed", outcome: "success")
    end
  end
end

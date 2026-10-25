class UserSession < ApplicationRecord
  # Conservative pilot defaults; ISP must confirm the final expiry policy.
  IDLE_TIMEOUT = 30.minutes
  ABSOLUTE_TIMEOUT = 12.hours
  TOKEN_FORMAT = /\A[0-9a-f]{64}\z/

  belongs_to :user
  validates :token_digest, :authentication_fingerprint, :last_seen_at, :expires_at, presence: true

  def self.issue(user, authenticated_password_digest:, mfa_verified: false)
    user.with_lock do
      return unless user.login_allowed? && user.password_digest == authenticated_password_digest
      return if user.admin_mfa_required? && !mfa_verified

      cleanup_expired!
      token = SecureRandom.hex(32)
      now = Time.current
      record = create!(user: user, token_digest: digest(token),
        authentication_fingerprint: user.authentication_fingerprint,
        last_seen_at: now, expires_at: now + ABSOLUTE_TIMEOUT, mfa_verified_at: mfa_verified ? now : nil)
      [record, token]
    end
  end

  def self.resume(token)
    return unless token.to_s.match?(TOKEN_FORMAT)

    record = includes(:user).find_by(token_digest: digest(token))
    return unless record

    now = Time.current
    if record.expires_at <= now || record.last_seen_at <= now - IDLE_TIMEOUT ||
        !record.user.login_allowed? || (record.user.admin_mfa_required? && record.mfa_verified_at.nil?) ||
        record.authentication_fingerprint != record.user.authentication_fingerprint
      record.destroy!
      return
    end

    # Never recreate a session deleted by logout/revocation on another worker.
    alive = where(id: record.id).where("expires_at > ? AND last_seen_at > ?", now, now - IDLE_TIMEOUT)
    record if alive.update_all(last_seen_at: now) == 1
  end

  def self.revoke_token(token)
    where(token_digest: digest(token)).delete_all if token.to_s.match?(TOKEN_FORMAT)
  end

  def self.cleanup_expired!
    now = Time.current
    where("expires_at <= ? OR last_seen_at <= ?", now, now - IDLE_TIMEOUT).limit(100).delete_all
  end

  def self.digest(token) = Digest::SHA256.hexdigest(token)
end

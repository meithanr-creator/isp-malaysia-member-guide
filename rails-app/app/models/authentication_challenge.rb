class AuthenticationChallenge < ApplicationRecord
  LIFETIME = 5.minutes
  belongs_to :user
  encrypts :otp_secret, :recovery_codes

  def self.issue(user, authenticated_password_digest:)
    user.with_lock do
      return unless user.password_login_allowed? && user.password_digest == authenticated_password_digest
      where(user: user, consumed_at: nil).update_all(consumed_at: Time.current, otp_secret: nil)
      where("expires_at <= ?", Time.current).limit(100).delete_all
      token = SecureRandom.hex(32)
      record = create!(user: user, token_digest: UserSession.digest(token),
        authentication_fingerprint: user.authentication_fingerprint, expires_at: Time.current + LIFETIME,
        otp_secret: user.otp_enabled_at ? nil : ROTP::Base32.random_base32)
      [record, token]
    end
  end

  def self.lookup(token)
    return unless token.to_s.match?(UserSession::TOKEN_FORMAT)
    find_by(token_digest: UserSession.digest(token))
  end

  def usable?
    consumed_at.nil? && expires_at > Time.current && user.password_login_allowed? &&
      authentication_fingerprint == user.authentication_fingerprint
  end

  # Caller already holds the user lock; lock order remains registry -> user -> token.
  def verify_factor!(code)
    lock!
    return false unless usable?
    return false if code.to_s.bytesize > 32
    input = code.to_s.delete(" -").upcase
    if user.otp_enabled_at
      verified_at = verify_totp(user.otp_secret, input, after: user.otp_last_used_at&.to_i)
      if verified_at
        user.update!(otp_last_used_at: Time.at(verified_at).utc)
      else
        digest = Digest::SHA256.hexdigest(input)
        remaining = user.recovery_code_digests.dup
        index = remaining.index(digest)
        return false unless index
        remaining.delete_at(index)
        user.update!(recovery_code_digests: remaining)
      end
      update!(consumed_at: Time.current)
    else
      verified_at = verify_totp(otp_secret, input)
      return false unless verified_at
      codes = Array.new(10) { SecureRandom.hex(10).upcase.scan(/.{1,5}/).join("-") }
      user.update!(otp_secret: otp_secret, otp_enabled_at: Time.current, otp_last_used_at: Time.at(verified_at).utc,
        recovery_code_digests: codes.map { |value| Digest::SHA256.hexdigest(value.delete("-")) })
      update!(consumed_at: Time.current, recovery_codes: codes.to_json, otp_secret: nil)
    end
    AccountSecurityEvent.create!(user: user, action: "administrator_mfa", outcome: "success")
    true
  end

  def take_recovery_codes!
    with_lock do
      return [] unless consumed_at && expires_at > Time.current && codes_viewed_at.nil? && recovery_codes.present?
      codes = JSON.parse(recovery_codes)
      update!(codes_viewed_at: Time.current, recovery_codes: nil)
      codes
    end
  end

  private

  def verify_totp(secret, code, after: nil)
    return unless code.match?(/\A\d{6}\z/)
    ROTP::TOTP.new(secret, issuer: "ISP Member Portal").verify(code, drift_behind: 30, drift_ahead: 30, after: after)
  end
end

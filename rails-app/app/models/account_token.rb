class AccountToken < ApplicationRecord
  LIFETIMES = { "activation" => 24.hours, "recovery" => 30.minutes }.freeze
  belongs_to :user
  encrypts :delivery_token
  validates :purpose, inclusion: { in: LIFETIMES.keys }

  def self.issue(user, purpose:)
    lifetime = LIFETIMES.fetch(purpose)
    user.with_lock do
      where(user: user, purpose: purpose, consumed_at: nil).update_all(consumed_at: Time.current, delivery_token: nil)
      where("expires_at <= ?", Time.current - 1.day).limit(100).delete_all
      token = SecureRandom.hex(32)
      record = create!(user: user, purpose: purpose, token_digest: UserSession.digest(token),
        authentication_fingerprint: user.authentication_fingerprint, delivery_token: token, expires_at: Time.current + lifetime)
      [record, token]
    end
  end

  def self.lookup(token, purpose:)
    return unless token.to_s.match?(UserSession::TOKEN_FORMAT)
    find_by(token_digest: UserSession.digest(token), purpose: purpose)
  end

  def usable?
    delivery_status == "sent" && consumed_at.nil? && expires_at > Time.current && authentication_fingerprint == user.authentication_fingerprint
  end
end

class LoginAttemptBucket < ApplicationRecord
  WINDOW = 3.minutes
  ACCOUNT_LIMIT = 10
  IP_LIMIT = 30

  # Shared database counters survive worker restarts. No raw email/IP is stored.
  def self.allowed?(email:, ip:, now: Time.current, purpose: "login")
    window, account_limit, ip_limit = {
      "login" => [WINDOW, ACCOUNT_LIMIT, IP_LIMIT], "recovery" => [15.minutes, 5, 20],
      "stepup" => [5.minutes, 5, 20], "mfa" => [5.minutes, 5, 20], "activation" => [15.minutes, 10, 30],
      "invitation" => [1.hour, 50, 100]
    }.fetch(purpose)
    window_start = Time.at((now.to_i / window.to_i) * window.to_i).utc
    account = email.to_s.first(161).strip.downcase
    scopes = [["#{purpose}:account", account, account_limit], ["#{purpose}:ip", ip.to_s, ip_limit]]
    counts = scopes.map do |scope, value, limit|
      result = upsert_all([{ scope_digest: scope_digest(scope, value), window_started_at: window_start,
        expires_at: window_start + window, attempts: 1 }],
        unique_by: %i[scope_digest window_started_at],
        on_duplicate: Arel.sql("attempts = login_attempt_buckets.attempts + 1"), returning: %w[attempts])
      result.rows.first.first <= limit
    end
    cleanup_expired!(now: now)
    counts.all?
  end

  def self.cleanup_expired!(now: Time.current)
    where("expires_at <= ?", now).limit(100).delete_all
  end

  def self.scope_digest(scope, value)
    key = Rails.application.key_generator.generate_key("isp-login-throttle", 32)
    OpenSSL::HMAC.hexdigest("SHA256", key, "#{scope}:#{value}")
  end
  private_class_method :scope_digest
end

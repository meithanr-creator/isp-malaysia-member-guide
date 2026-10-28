require "uri"

# Checks configuration shape only. Passing does not approve a production release.
module ProductionConfiguration
  REQUIRED = %w[DATABASE_URL SECRET_KEY_BASE APP_HOST STORAGE_BUCKET AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY MAIL_FROM CLAMD_HOST ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT].freeze
  HOST = /\A(?=.{1,253}\z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\z/i

  def self.hosts(env = ENV)
    [ env["APP_HOST"], *env.fetch("APP_ADDITIONAL_HOSTS", "").split(",") ].map { |host| host.to_s.strip.downcase }.reject(&:empty?).uniq
  end

  def self.errors(env = ENV)
    errors = REQUIRED.filter_map { |key| "#{key} is required" if env[key].to_s.strip.empty? }
    errors << "SECRET_KEY_BASE must contain at least 64 characters" if env["SECRET_KEY_BASE"].to_s.length < 64
    database = parse_uri(env["DATABASE_URL"])
    errors << "DATABASE_URL must use PostgreSQL with a host and database" unless database && %w[postgres postgresql].include?(database.scheme) && database.host && database.path.to_s.length > 1
    errors << "DB_SSLMODE must be require or verify-full" unless %w[require verify-full].include?(env.fetch("DB_SSLMODE", "require"))
    errors << "APP_HOST and APP_ADDITIONAL_HOSTS must be explicit public hostnames" unless hosts(env).any? && hosts(env).all? { |host| HOST.match?(host) && !host.match?(/(?:\A|\.)(?:localhost|example\.(?:com|org|net)|invalid|test)\z/i) }
    errors << "MAIL_FROM must be a sender email address" unless env["MAIL_FROM"].to_s.match?(/\A[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+\z/)
    errors << "SECRET_KEY_BASE_DUMMY is only permitted for assets:precompile" unless env["SECRET_KEY_BASE_DUMMY"].to_s.empty?
    errors << "ISP_DEMO_MODE must not be enabled in production" if env["ISP_DEMO_MODE"] == "true"
    %w[ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT].each do |key|
      errors << "#{key} must contain at least 32 characters" if env[key].to_s.length < 32
    end
    if env["ISP_ACCOUNT_EMAILS_ENABLED"] == "true"
      errors << "ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED must be true when account email is enabled" unless env["ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED"] == "true"
      %w[SMTP_ADDRESS SMTP_USERNAME SMTP_PASSWORD].each { |key| errors << "#{key} is required when account email is enabled" if env[key].to_s.strip.empty? }
    end
    errors << "SMTP_PORT must be a port number" unless valid_port?(env.fetch("SMTP_PORT", "587"))
    errors << "CLAMD_PORT must be a port number" unless valid_port?(env.fetch("CLAMD_PORT", "3310"))
    endpoint = env["STORAGE_ENDPOINT"].to_s
    if !endpoint.empty? && !(parse_uri(endpoint)&.then { |uri| uri.scheme == "https" && uri.host && !uri.userinfo && !uri.query && !uri.fragment })
      errors << "STORAGE_ENDPOINT must be an HTTPS URL without credentials, query or fragment"
    end
    errors << "RAILS_LOG_LEVEL must be info, warn, error or fatal in production" unless %w[info warn error fatal].include?(env.fetch("RAILS_LOG_LEVEL", "info"))
    errors
  end

  def self.validate!(env = ENV)
    problems = errors(env)
    raise "Production configuration is incomplete: #{problems.join('; ')}" if problems.any?
  end

  def self.parse_uri(value)
    URI.parse(value.to_s)
  rescue URI::InvalidURIError
    nil
  end
  private_class_method :parse_uri

  def self.valid_port?(value)
    value.to_s.match?(/\A\d+\z/) && (1..65535).cover?(value.to_i)
  end
  private_class_method :valid_port?
end

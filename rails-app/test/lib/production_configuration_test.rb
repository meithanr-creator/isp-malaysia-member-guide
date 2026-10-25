require "minitest/autorun"
require_relative "../../lib/production_configuration"

class ProductionConfigurationTest < Minitest::Test
  def valid_environment
    {
      "DATABASE_URL" => "postgresql://member:password@private.db.internal/isp_production",
      "SECRET_KEY_BASE" => "a" * 64, "APP_HOST" => "isp-staging.onrender.com",
      "STORAGE_BUCKET" => "isp-staging-private", "AWS_REGION" => "ap-southeast-1",
      "AWS_ACCESS_KEY_ID" => "key", "AWS_SECRET_ACCESS_KEY" => "secret",
      "MAIL_FROM" => "membership@isp.org.my", "CLAMD_HOST" => "clamd.private.internal",
      "ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY" => "p" * 32,
      "ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY" => "d" * 32,
      "ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT" => "s" * 32
    }
  end

  def test_requires_explicit_runtime_secrets_and_services
    errors = ProductionConfiguration.errors({})
    %w[DATABASE_URL SECRET_KEY_BASE APP_HOST STORAGE_BUCKET CLAMD_HOST].each do |key|
      assert errors.any? { |error| error.start_with?(key) }, key
    end
  end

  def test_valid_shape_does_not_need_enabled_email_or_custom_domain
    assert_empty ProductionConfiguration.errors(valid_environment)
  end

  def test_rejects_non_postgresql_database_and_insecure_database_transport
    errors = ProductionConfiguration.errors(valid_environment.merge("DATABASE_URL" => "sqlite3:storage/production.sqlite3", "DB_SSLMODE" => "disable"))
    assert errors.any? { |error| error.start_with?("DATABASE_URL") }
    assert errors.any? { |error| error.start_with?("DB_SSLMODE") }
  end

  def test_rejects_wildcard_url_placeholder_and_local_hosts
    %w[*.isp.org.my https://isp.org.my localhost example.com isp.test].each do |host|
      assert ProductionConfiguration.errors(valid_environment.merge("APP_HOST" => host)).any? { |error| error.start_with?("APP_HOST") }, host
    end
  end

  def test_additional_hosts_are_explicit
    assert_equal %w[isp-staging.onrender.com members.isp.org.my], ProductionConfiguration.hosts(valid_environment.merge("APP_ADDITIONAL_HOSTS" => "members.isp.org.my, ISP-STAGING.onrender.com"))
  end

  def test_rejects_dummy_secret_demo_mode_and_debug_logging
    errors = ProductionConfiguration.errors(valid_environment.merge("SECRET_KEY_BASE_DUMMY" => "1", "ISP_DEMO_MODE" => "true", "RAILS_LOG_LEVEL" => "debug"))
    assert errors.any? { |error| error.start_with?("SECRET_KEY_BASE_DUMMY") }
    assert errors.any? { |error| error.start_with?("ISP_DEMO_MODE") }
    assert errors.any? { |error| error.start_with?("RAILS_LOG_LEVEL") }
  end

  def test_enabled_mail_requires_transport_credentials
    errors = ProductionConfiguration.errors(valid_environment.merge("ISP_ACCOUNT_EMAILS_ENABLED" => "true"))
    %w[SMTP_ADDRESS SMTP_USERNAME SMTP_PASSWORD].each { |key| assert errors.any? { |error| error.start_with?(key) } }
  end

  def test_endpoint_never_accepts_plaintext_or_embedded_secrets
    %w[http://storage.internal https://key:secret@storage.test https://storage.test/?key=secret].each do |url|
      assert ProductionConfiguration.errors(valid_environment.merge("STORAGE_ENDPOINT" => url)).any? { |error| error.start_with?("STORAGE_ENDPOINT") }
    end
  end
end

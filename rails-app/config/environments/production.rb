require "active_support/core_ext/integer/time"
require_relative "../../lib/production_configuration"

# Rails' dummy secret is supported solely for the asset compilation task. It must
# never permit an HTTP server, console, migration or preflight to bypass checks.
asset_build = ENV["SECRET_KEY_BASE_DUMMY"] == "1" && defined?(Rake) && Rake.respond_to?(:application) && Rake.application.top_level_tasks == [ "assets:precompile" ]
ProductionConfiguration.validate! unless asset_build

Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = true
  config.consider_all_requests_local = false
  config.action_controller.perform_caching = true
  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }
  config.active_storage.service = asset_build ? :local : :production_private
  config.active_storage.draw_routes = false

  # The approved runtime must terminate TLS and forward only trusted requests.
  config.assume_ssl = true
  config.force_ssl = true
  config.ssl_options = { redirect: { exclude: ->(request) { %w[/up /ready].include?(request.path) } } }
  config.hosts = ProductionConfiguration.hosts
  config.host_authorization = { exclude: ->(request) { %w[/up /ready].include?(request.path) } }
  config.action_controller.default_url_options = { host: ENV["APP_HOST"], protocol: "https" }

  config.log_tags = [ :request_id ]
  config.logger = ActiveSupport::TaggedLogging.logger(STDOUT)
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")
  config.silence_healthcheck_path = "/up"
  config.active_support.report_deprecations = false
  # No cached personal pages and no unprovisioned queue database. Identity mail
  # uses deliver_now: provider outages surface as failures, never false success.
  config.cache_store = :null_store
  config.active_job.queue_adapter = :inline
  config.action_mailer.default_url_options = { host: ENV["APP_HOST"], protocol: "https" }
  config.action_mailer.delivery_method = :smtp
  config.action_mailer.perform_deliveries = ENV["ISP_ACCOUNT_EMAILS_ENABLED"] == "true"
  config.action_mailer.raise_delivery_errors = true
  config.action_mailer.default_options = { from: ENV["MAIL_FROM"] }
  config.action_mailer.smtp_settings = {
    address: ENV["SMTP_ADDRESS"], port: ENV.fetch("SMTP_PORT", "587").to_i,
    domain: ENV.fetch("SMTP_DOMAIN", ENV["APP_HOST"]),
    user_name: ENV["SMTP_USERNAME"], password: ENV["SMTP_PASSWORD"],
    authentication: :plain, enable_starttls: true, openssl_verify_mode: "peer",
    open_timeout: 5, read_timeout: 10
  }
  config.i18n.fallbacks = true
  config.active_record.dump_schema_after_migration = false
  config.active_record.attributes_for_inspect = [ :id ]
end

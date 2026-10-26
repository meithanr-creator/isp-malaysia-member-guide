class HealthController < ActionController::API
  class ReadinessChecks
    def database!
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection.select_value("SELECT 1")
      end
    end

    def schema!
      ActiveRecord::Migration.check_all_pending!
    end

    def full_dependencies? = Rails.env.production?

    def storage!
      ActiveStorage::Blob.service.exist?("health/readiness-probe")
    end

    def scanner!
      raise "Scanner unavailable" if UploadScanner.new.readiness_error
    end
  end

  # A controller-local test seam; application connection pools remain intact.
  def self.readiness_checks = ReadinessChecks.new

  before_action :prevent_caching
  rescue_from StandardError, with: :not_ready

  def application_ready
    check_application!
    render plain: "application ready", status: :ok
  end

  def ready
    check_application!
    if readiness_checks.full_dependencies?
      readiness_checks.storage!
      readiness_checks.scanner!
    end
    render plain: "ready", status: :ok
  end

  private

  def readiness_checks
    @readiness_checks ||= self.class.readiness_checks
  end

  def check_application!
    readiness_checks.database!
    readiness_checks.schema!
  end

  def prevent_caching
    response.headers["Cache-Control"] = "no-store"
  end

  def not_ready(error)
    Rails.logger.error("Readiness failed: #{error.class.name}")
    render plain: "not ready", status: :service_unavailable
  end
end

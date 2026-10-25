class HealthController < ActionController::API
  def ready
    response.headers["Cache-Control"] = "no-store"
    ActiveRecord::Base.connection_pool.with_connection { |connection| connection.select_value("SELECT 1") }
    ActiveRecord::Migration.check_all_pending!
    if Rails.env.production?
      # HEAD of a deliberately absent object checks authenticated service access
      # without generating an object on every platform health probe.
      ActiveStorage::Blob.service.exist?("health/readiness-probe")
      raise "Scanner unavailable" if UploadScanner.new.readiness_error
    end
    render plain: "ready", status: :ok
  rescue StandardError => error
    Rails.logger.error("Readiness failed: #{error.class.name}")
    render plain: "not ready", status: :service_unavailable
  end
end

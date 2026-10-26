require "test_helper"
require "minitest/mock"

class HealthControllerTest < ActionDispatch::IntegrationTest
  class ControlledChecks < HealthController::ReadinessChecks
    attr_reader :calls

    def initialize(database_error: nil, schema_error: nil,
      storage_error: nil, scanner_error: nil)
      @calls = []
      @database_error, @schema_error = database_error, schema_error
      @storage_error, @scanner_error = storage_error, scanner_error
    end

    def database!
      calls << :database
      raise @database_error if @database_error
      super
    end

    def schema!
      calls << :schema
      raise @schema_error if @schema_error
      super
    end

    def full_dependencies? = true

    def storage!
      calls << :storage
      raise @storage_error if @storage_error
      false
    end

    def scanner!
      calls << :scanner
      raise @scanner_error if @scanner_error
    end
  end

  test "application readiness uses real SQL and schema without storage or scanner" do
    with_health_checks(storage_error: "private storage diagnostic",
      scanner_error: "private scanner diagnostic") do |calls|
      statements = []
      subscriber = ->(*arguments) { statements << arguments.last[:sql] }
      ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") do
        get application_readiness_path
      end
      assert_response :success
      assert_equal "application ready", response.body
      assert_equal "no-store", response.headers["Cache-Control"]
      assert_equal [:database, :schema], calls
      assert_includes statements, "SELECT 1"
    end
  end

  test "application readiness fails closed when database access fails" do
    with_health_checks(database_error: "private database diagnostic") do |calls|
      get application_readiness_path
      assert_response :service_unavailable
      assert_equal "not ready", response.body
      assert_equal "no-store", response.headers["Cache-Control"]
      assert_equal [:database], calls
    end
  end

  test "application readiness rejects incompatible migrations" do
    with_health_checks(schema_error: "private migration diagnostic") do |calls|
      get application_readiness_path
      assert_response :service_unavailable
      assert_equal "not ready", response.body
      assert_equal [:database, :schema], calls
    end
  end

  test "full readiness still checks database schema storage and scanner" do
    with_health_checks do |calls|
      get "/ready"
      assert_response :success
      assert_equal "ready", response.body
      assert_equal "no-store", response.headers["Cache-Control"]
      assert_equal [:database, :schema, :storage, :scanner], calls
    end
  end

  test "full readiness rejects scanner failure without leaking details" do
    with_health_checks(scanner_error: "private scanner diagnostic") do |calls|
      get "/ready"
      assert_response :service_unavailable
      assert_equal "not ready", response.body
      assert_equal [:database, :schema, :storage, :scanner], calls
    end
  end

  test "full readiness rejects storage failure before scanner checking" do
    with_health_checks(storage_error: "private storage diagnostic") do |calls|
      get "/ready"
      assert_response :service_unavailable
      assert_equal "not ready", response.body
      assert_equal [:database, :schema, :storage], calls
    end
  end

  test "liveness remains independent of database storage and scanner" do
    with_health_checks(database_error: "private database diagnostic",
      storage_error: "private storage diagnostic",
      scanner_error: "private scanner diagnostic") do |calls|
      get rails_health_check_path
      assert_response :success
      assert_empty calls
    end
  end

  private

  def with_health_checks(**errors)
    checks = ControlledChecks.new(**errors)
    HealthController.stub(:readiness_checks, checks) { yield checks.calls }
  end
end

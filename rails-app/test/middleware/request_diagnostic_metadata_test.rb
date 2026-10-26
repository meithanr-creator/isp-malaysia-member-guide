require "test_helper"

class RequestDiagnosticMetadataTest < ActiveSupport::TestCase
  TRACE = "12345678-1234-1234-1234-123456789abc"
  OPERATION = "87654321-4321-4321-4321-cba987654321"

  test "metadata wraps actual Rails exception rendering without changing the body or status" do
    error = IOError.new("synthetic private member and credential text")
    body = ["generic failure"]
    exception_app = ->(_env) { [500, { "content-type" => "text/plain" }.freeze, body] }
    renderer = ActionDispatch::ShowExceptions.new(->(_env) { raise error }, exception_app)
    app = RequestDiagnosticMetadata.new(renderer)
    env = Rack::MockRequest.env_for("/private?password=synthetic")
    env.merge!("HTTP_X_ISP_TRACE" => TRACE, "isp.upload_operation_id" => OPERATION,
      "action_dispatch.show_exceptions" => :all,
      "action_dispatch.backtrace_cleaner" => Rails.backtrace_cleaner)
    status, headers, returned = app.call(env)
    assert_equal 500, status
    assert_same body, returned
    assert_equal "text/plain", headers["content-type"]
    assert_equal TRACE, headers["x-isp-trace"]
    assert_equal OPERATION, headers["x-isp-diagnostic-operation"]
    assert_equal "IOError", headers["x-isp-diagnostic-exception"]
    assert_not_includes headers.to_json, "synthetic"
  end

  test "direct exceptions are re-raised unchanged" do
    error = IOError.new("private")
    app = RequestDiagnosticMetadata.new(->(_env) { raise error })
    assert_same error, assert_raises(IOError) { app.call({ "HTTP_X_ISP_TRACE" => TRACE }) }
  end

  test "ordinary responses preserve cookies and streaming body without reading it" do
    body = Object.new
    def body.each = raise("body must not be read")
    app = RequestDiagnosticMetadata.new(->(_env) {
      [422, { "set-cookie" => "session=synthetic; Secure; HttpOnly",
        "X-ISP-Diagnostic-Spoof" => "private", "X-ISP-Trace" => "spoof" }.freeze, body]
    })
    status, headers, returned = app.call({ "HTTP_X_ISP_TRACE" => TRACE,
      "isp.upload_operation_id" => OPERATION, "isp.exception_class" => "UploadOperation::StorageFailure" })
    assert_equal 422, status
    assert_same body, returned
    assert_equal "session=synthetic; Secure; HttpOnly", headers["set-cookie"]
    assert_equal TRACE, headers["x-isp-trace"]
    assert_equal "UploadOperation::StorageFailure", headers["x-isp-diagnostic-exception"]
    assert_not headers.keys.any? { |key| key.downcase.include?("spoof") }
  end

  test "invalid traces omit all diagnostic metadata including pre-existing headers" do
    [nil, "", TRACE + "\n", TRACE.upcase, "member@example.test"].each do |trace|
      app = RequestDiagnosticMetadata.new(->(_env) { [200,
        { "x-isp-trace" => TRACE, "x-isp-diagnostic-exception" => "IOError" }, []] })
      _, headers, = app.call({ "HTTP_X_ISP_TRACE" => trace,
        "isp.upload_operation_id" => OPERATION, "isp.exception_class" => "IOError" })
      assert_empty headers
    end
  end

  test "malformed operation and class metadata cannot escape through headers" do
    ["private secret", "IOError\nInjected", "A" * 121, "bad::name"].each do |name|
      app = RequestDiagnosticMetadata.new(->(_env) { [200, {}, []] })
      _, headers, = app.call({ "HTTP_X_ISP_TRACE" => TRACE,
        "isp.upload_operation_id" => OPERATION + "\n", "isp.exception_class" => name })
      assert_equal({ "x-isp-trace" => TRACE }, headers)
    end
  end

  test "middleware observes the response outside Rails ShowExceptions" do
    stack = Rails.application.middleware.map(&:klass)
    assert_operator stack.index(RequestDiagnosticMetadata), :<, stack.index(ActionDispatch::ShowExceptions)
  end
end

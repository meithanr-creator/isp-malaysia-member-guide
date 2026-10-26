class RequestDiagnosticMetadata
  UUID = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
  CLASS_NAME = /\A[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*\z/
  PREFIX = "x-isp-diagnostic-"
  def initialize(app) = @app = app

  def call(env)
    status, headers, body = @app.call(env)
    headers = headers.reject { |name, _| name.downcase.start_with?(PREFIX) || name.downcase == "x-isp-trace" }
    trace = env["HTTP_X_ISP_TRACE"].to_s
    if UUID.match?(trace)
      headers["x-isp-trace"] = trace
      operation = env["isp.upload_operation_id"].to_s
      headers["#{PREFIX}operation"] = operation if UUID.match?(operation)
      error = env["action_dispatch.exception"]
      name = (error ? error.class.name : env["isp.exception_class"]).to_s
      headers["#{PREFIX}exception"] = name if name.bytesize <= 120 && CLASS_NAME.match?(name)
    end
    [status, headers, body]
  end
end

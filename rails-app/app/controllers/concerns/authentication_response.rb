module AuthenticationResponse
  extend ActiveSupport::Concern
  included { before_action :protect_authentication_response }
  private
  def protect_authentication_response
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Referrer-Policy"] = "no-referrer"
  end
end

class ApplicationController < ActionController::Base
  stale_when_importmap_changes
  helper_method :current_user, :demo_mode?, :account_path
  before_action :private_response_cache

  private

  def current_user
    @current_user ||= User.find_by(id: session[:user_id]) if session[:user_id]
  end

  def demo_mode?
    !Rails.env.production? && ENV.fetch("ISP_DEMO_MODE", Rails.env.development? ? "true" : "false") == "true"
  end

  def private_response_cache
    response.headers["Cache-Control"] = "no-store, private" if current_user || %w[sessions].include?(controller_name) || controller_path.start_with?("admin/", "member/")
  end

  def account_path
    return login_path unless current_user
    current_user.admin? ? admin_events_path : member_dashboard_path
  end

  def require_login
    return true if current_user
    session[:return_to] = safe_return_path(request.fullpath) if request.get? || request.head?
    redirect_to login_path, notice: "Login to continue. We will bring you back to the page you requested."
    false
  end

  def require_member
    return unless require_login
    return if current_user.member?
    render "shared/forbidden", status: :forbidden
  end

  def require_admin
    return unless require_login
    return if current_user.admin?
    render "shared/forbidden", status: :forbidden
  end

  def safe_return_path(path)
    value = path.to_s
    return unless value.start_with?("/") && !value.start_with?("//") && !value.match?(/[\\\r\n]/)
    return unless value.match?(%r{\A/(?:events(?:/|\?|\z)|member(?:/|\z)|admin(?:/|\z))})
    value
  end
end

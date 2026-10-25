class SessionsController < ApplicationController
  include AuthenticationResponse
  before_action :enforce_login_limit, only: :create

  def new
    redirect_to(current_user.admin? ? admin_events_path : member_dashboard_path) if current_user
  end

  def create
    user = User.authenticate_credentials(params[:email], params[:password])
    if user
      if user.admin_mfa_required?
        challenge = AuthenticationChallenge.issue(user, authenticated_password_digest: user.password_digest)
        return reject_credentials unless challenge
        destination = safe_return_path(session[:return_to])
        UserSession.revoke_token(session[:authentication_token])
        revoke_pending_authentication
        reset_session
        session[:authentication_challenge] = challenge.last
        session[:return_to] = destination if destination
        return redirect_to two_factor_path
      end
      return sign_in(user)
    end

    reject_credentials
  end

  def demo
    return head :not_found unless demo_mode?
    user = User.find_by!(email: params[:role] == "admin" ? "admin@example.com" : "member@example.com")
    sign_in(user)
  end

  def destroy
    UserSession.revoke_token(session[:authentication_token])
    revoke_pending_authentication
    reset_session
    redirect_to root_path, notice: "Signed out. See you again soon."
  end

  private

  def enforce_login_limit
    return if LoginAttemptBucket.allowed?(email: params[:email], ip: request.remote_ip)
    redirect_to login_path, alert: "Please wait a moment before trying again."
  end

  def reject_credentials
    flash.now[:alert] = "The email or password did not match. Please try again."
    render :new, status: :unprocessable_entity
  end

  def sign_in(user)
    authentication = UserSession.issue(user, authenticated_password_digest: user.password_digest)
    return reject_credentials unless authentication

    destination = safe_return_path(session[:return_to])
    UserSession.revoke_token(session[:authentication_token])
    revoke_pending_authentication
    reset_session
    session[:authentication_token] = authentication.last
    redirect_to destination || (user.admin? ? admin_events_path : member_dashboard_path), notice: demo_mode? ? "Demo account opened. Use sample details." : "Welcome back."
  end
end

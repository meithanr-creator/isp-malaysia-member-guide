class TwoFactorController < ApplicationController
  include AuthenticationResponse
  before_action :load_challenge, only: [:new, :create, :destroy]
  before_action :require_admin, only: :recovery_codes

  def new; end

  def create
    unless LoginAttemptBucket.allowed?(email: @challenge.user.email, ip: request.remote_ip, purpose: "mfa")
      flash.now[:alert] = "Please wait before trying another verification code."
      return render :new, status: :too_many_requests
    end
    authentication = nil
    user = @challenge.user
    user.with_lock do
      if @challenge.verify_factor!(params[:otp_code])
        authentication = UserSession.issue(user, authenticated_password_digest: user.password_digest, mfa_verified: true)
      end
    end
    unless authentication
      AccountSecurityEvent.create!(user: user, action: "administrator_mfa", outcome: "rejected")
      flash.now[:alert] = "That code did not match or has already been used. Try a current code or an unused recovery code."
      return render :new, status: :unprocessable_entity
    end
    destination = safe_return_path(session[:return_to])
    challenge_token = session[:authentication_challenge]
    UserSession.revoke_token(session[:authentication_token])
    reset_session
    session[:authentication_token] = authentication.last
    if @challenge.recovery_codes.present?
      session[:recovery_display_token] = challenge_token
      redirect_to two_factor_recovery_codes_path
    else
      redirect_to destination || admin_events_path, notice: "Administrator verification completed."
    end
  end

  def destroy
    @challenge.update!(consumed_at: Time.current, otp_secret: nil)
    reset_session
    redirect_to login_path, notice: "Administrator sign-in cancelled."
  end

  def recovery_codes
    challenge = AuthenticationChallenge.lookup(session.delete(:recovery_display_token))
    @codes = challenge&.user_id == current_user.id ? challenge.take_recovery_codes! : []
    redirect_to admin_events_path, alert: "Recovery codes have already been shown or are unavailable." if @codes.empty?
  end

  private

  def load_challenge
    @challenge = AuthenticationChallenge.lookup(session[:authentication_challenge])
    return if @challenge&.usable?
    reset_session
    redirect_to login_path, alert: "Administrator sign-in expired. Enter your password again."
  end
end

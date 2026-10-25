class PasswordRecoveriesController < ApplicationController
  include AuthenticationResponse
  RESPONSE = "If an eligible account exists, a reset link has been requested. Check your email. If it does not arrive, contact ISP through your usual trusted contact."

  def new; end
  def edit; end

  def create
    if LoginAttemptBucket.allowed?(email: params[:email], ip: request.remote_ip, purpose: "recovery")
      PasswordRecoveryRequest.call(email: params[:email])
    end
    redirect_to password_recovery_path, notice: RESPONSE
  end

  def update
    @token = params[:token].to_s
    unless LoginAttemptBucket.allowed?(email: @token, ip: request.remote_ip, purpose: "activation")
      flash.now[:alert] = "Please wait before trying this link again."
      return render :edit, status: :too_many_requests
    end
    result = AccountTokenConsumer.call(token: @token, purpose: "recovery", password: params[:password], password_confirmation: params[:password_confirmation])
    if result.success?
      UserSession.revoke_token(session[:authentication_token])
      revoke_pending_authentication
      reset_session
      redirect_to login_path, notice: "Your password has been changed and previous sessions closed. Sign in again. Administrator verification is still required."
    else
      flash.now[:alert] = result.error
      render :edit, status: :unprocessable_entity
    end
  end
end

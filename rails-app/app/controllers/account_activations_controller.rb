class AccountActivationsController < ApplicationController
  include AuthenticationResponse

  def edit; end

  def update
    @token = params[:token].to_s
    unless LoginAttemptBucket.allowed?(email: @token, ip: request.remote_ip, purpose: "activation")
      flash.now[:alert] = "Please wait before trying this link again."
      return render :edit, status: :too_many_requests
    end
    result = AccountTokenConsumer.call(token: @token, purpose: "activation", password: params[:password], password_confirmation: params[:password_confirmation])
    if result.success?
      revoke_pending_authentication
      reset_session
      redirect_to login_path, notice: "Your account is activated. Sign in with your new password. Administrators will also set up an authenticator."
    else
      flash.now[:alert] = result.error
      render :edit, status: :unprocessable_entity
    end
  end
end

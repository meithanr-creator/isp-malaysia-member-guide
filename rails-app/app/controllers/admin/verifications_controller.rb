module Admin
  class VerificationsController < ApplicationController
    include AuthenticationResponse
    before_action :require_admin

    def new
      destination = safe_return_path(params[:return_to])
      session[:admin_verification_return_to] = destination if destination
    end

    def create
      unless LoginAttemptBucket.allowed?(email: current_user.email, ip: request.remote_ip, purpose: "stepup")
        flash.now[:alert] = "Please wait before trying administrator verification again."
        return render :new, status: :too_many_requests
      end
      authentication = nil
      user = current_user
      user.with_lock do
        code = params[:otp_code].to_s
        password = params[:password].to_s
        valid = user.admin? && user.login_allowed? && password.bytesize <= 72 && user.authenticate(password)
        if valid && user.otp_enabled_at && code.match?(/\A\d{6}\z/)
          verified_at = ROTP::TOTP.new(user.otp_secret, issuer: "ISP Member Portal").verify(code,
            drift_behind: 30, drift_ahead: 30, after: user.otp_last_used_at&.to_i)
          if verified_at
            user.update!(otp_last_used_at: Time.at(verified_at).utc)
            authentication = UserSession.issue(user, authenticated_password_digest: user.password_digest, mfa_verified: true)
          end
        end
      end
      unless authentication
        flash.now[:alert] = "Password or authenticator code did not match. Use a current code that has not been used before."
        return render :new, status: :unprocessable_entity
      end
      UserSession.revoke_token(session[:authentication_token])
      session[:authentication_token] = authentication.last
      destination = safe_return_path(session.delete(:admin_verification_return_to))
      AccountSecurityEvent.create!(user: user, action: "administrator_stepup", outcome: "success")
      redirect_to destination || admin_events_path, notice: "Administrator access verified. Return to your open form and save again."
    end
  end
end

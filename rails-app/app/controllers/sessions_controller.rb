class SessionsController < ApplicationController
  rate_limit to: 10, within: 3.minutes, only: :create, store: ActiveSupport::Cache::MemoryStore.new, with: -> { redirect_to login_path, alert: "Please wait a moment before trying again." }
  def new
    redirect_to(current_user.admin? ? admin_events_path : member_dashboard_path) if current_user
  end
  def create
    user = User.find_by(email: params[:email].to_s.strip.downcase)
    if user&.authenticate(params[:password].to_s)
      sign_in(user)
    else
      flash.now[:alert] = "The email or password did not match. Please try again."
      render :new, status: :unprocessable_entity
    end
  end
  def demo
    return head :not_found unless demo_mode?
    user = User.find_by!(email: params[:role] == "admin" ? "admin@example.com" : "member@example.com")
    sign_in(user)
  end
  def destroy
    reset_session
    redirect_to root_path, notice: "Signed out. See you again soon."
  end
  private
  def sign_in(user)
    destination = safe_return_path(session[:return_to])
    reset_session
    session[:user_id] = user.id
    redirect_to destination || (user.admin? ? admin_events_path : member_dashboard_path), notice: demo_mode? ? "Demo account opened. Use sample details." : "Welcome back."
  end
end

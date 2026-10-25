module Member
  class ProfilesController < ApplicationController
    before_action :require_member
    def edit; end
    def update
      if current_user.update(params.require(:user).permit(:name, :company, :branch, :phone))
        redirect_to member_dashboard_path, notice: "Your profile has been updated."
      else
        render :edit, status: :unprocessable_entity
      end
    end
  end
end

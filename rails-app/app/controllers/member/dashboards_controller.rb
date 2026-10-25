module Member
  class DashboardsController < ApplicationController
    before_action :require_member
    def show
      @interests = current_user.event_interests.includes(:event).order(created_at: :desc)
    end
  end
end

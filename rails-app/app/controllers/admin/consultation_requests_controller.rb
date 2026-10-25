module Admin
  class ConsultationRequestsController < ApplicationController
    before_action :require_admin
    def index
      @requests = ConsultationRequest.includes(:user).order(created_at: :desc).limit(100)
    end

    def show
      @consultation_request = ConsultationRequest.includes(:user).find(params[:id])
    end
  end
end

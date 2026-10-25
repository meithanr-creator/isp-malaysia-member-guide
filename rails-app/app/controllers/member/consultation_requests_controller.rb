module Member
  class ConsultationRequestsController < ApplicationController
    before_action :require_member
    def index
      @requests = current_user.consultation_requests.order(created_at: :desc).limit(100)
    end

    def new
      @consultation_request = current_user.consultation_requests.new(request_key: SecureRandom.uuid)
    end

    def show
      @consultation_request = current_user.consultation_requests.find(params[:id])
    end

    def create
      attributes = params.require(:consultation_request).permit(:category, :subject, :message, :request_key)
      existing = current_user.consultation_requests.find_by(request_key: attributes[:request_key]) if attributes[:request_key].present?
      return redirect_to member_consultation_request_path(existing), notice: "This enquiry has already been received." if existing

      @consultation_request = current_user.consultation_requests.new(attributes)
      if @consultation_request.save
        redirect_to member_consultation_request_path(@consultation_request), notice: "Your enquiry has been received. Keep the reference below for your records."
      else
        render :new, status: :unprocessable_entity
      end
    rescue ActiveRecord::RecordNotUnique
      existing = current_user.consultation_requests.find_by!(request_key: attributes[:request_key])
      redirect_to member_consultation_request_path(existing), notice: "This enquiry has already been received."
    end
  end
end

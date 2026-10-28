module Admin
  class EventInterestsController < ApplicationController
    PAGE_SIZE = 50
    before_action :require_admin

    def index
      @event = Event.find_by!(slug: params[:event_id])
      @total_interests = @event.event_interests.count
      @total_pages = [ (@total_interests.to_f / PAGE_SIZE).ceil, 1 ].max
      page = params[:page].presence || "1"
      return head :not_found unless page.is_a?(String) && page.match?(/\A[1-9]\d{0,5}\z/)
      @page = page.to_i
      return head :not_found if @page > @total_pages

      # Use the contact details submitted with the interest, not the current
      # member profile or event/payment snapshot. Keep each query bounded.
      @interests = @event.event_interests
        .select(:id, :name, :email, :company, :created_at, :event_revision)
        .order(created_at: :desc, id: :desc)
        .offset((@page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
    end
  end
end

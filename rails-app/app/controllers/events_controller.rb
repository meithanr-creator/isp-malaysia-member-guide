class EventsController < ApplicationController
  def index
    @format = params[:format].presence
    @events = Event.published.sort_by { |event| event.published_data.fetch("date", "9999") }
    @events.select! { |event| event.published_data["format"] == @format } if @format
  end
  def show
    @event = Event.published.find_by!(slug: params[:id])
    @data = @event.published_data
    @interest = current_user&.event_interests&.find_by(event: @event)
  end
end

class HomeController < ApplicationController
  def index
    @discover_slides = DiscoverSlide.ordered
    @member_publications = current_user&.member? ? Publication.published.limit(2) : []
    @events = Event.published.sort_by { |event| event.published_data.fetch("date", "9999") }.first(2)
  end
  def about; end
end

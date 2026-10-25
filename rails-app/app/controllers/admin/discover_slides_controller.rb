module Admin
  class DiscoverSlidesController < ApplicationController
    before_action :require_admin

    def index
      @slides = DiscoverSlide.ordered
    end

    def update
      @slide = DiscoverSlide.find(params[:id])
      attributes = params.require(:discover_slide).permit(:tag, :title, :description, :website_url, :image_alt, :image, :lock_version)
      if DiscoverSlideUpdater.new(@slide).call(attributes: attributes.slice(:tag, :title, :description, :website_url, :image_alt).to_h, image: attributes[:image], expected_lock_version: attributes[:lock_version])
        redirect_to admin_discover_path(anchor: "discover-card-#{@slide.id}"), notice: "Discover card #{@slide.position} saved. The homepage now shows this version."
      else
        @slides = DiscoverSlide.ordered.map { |slide| slide.id == @slide.id ? @slide : slide }
        render :index, status: :unprocessable_entity
      end
    end
  end
end

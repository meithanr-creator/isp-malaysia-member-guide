module Member
  class PublicationsController < ApplicationController
    before_action :require_member

    def index
      @publications = Publication.published
    end

    def show
      @publication = Publication.published.find_by!(slug: params[:id])
      raise ActiveRecord::RecordNotFound unless @publication.published?
      @data = @publication.published_data
    end
  end
end

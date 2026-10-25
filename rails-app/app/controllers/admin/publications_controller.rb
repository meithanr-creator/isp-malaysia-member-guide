module Admin
  class PublicationsController < ApplicationController
    before_action :require_admin
    before_action :set_publication, only: %i[edit update preview prepare_preview publish]

    def index
      @publications = Publication.order(updated_at: :desc)
    end

    def new
      @publication = Publication.new
      @publication.valid?
    end

    def create
      params.require(:publication)
      @publication = Publication.create!
      params[:publication][:lock_version] = @publication.lock_version
      update_draft
    end

    def edit; end

    def update
      update_draft
    end

    def preview
      unless @publication.preview_current?
        return redirect_to edit_admin_publication_path(@publication), alert: "The draft has changed. Create a fresh preview before publishing."
      end
      @data = @publication.preview_data
    end

    def prepare_preview
      @publication.prepare_preview!(expected_lock_version: params[:lock_version])
      redirect_to preview_admin_publication_path(@publication)
    rescue Publication::InvalidTransition => error
      redirect_to edit_admin_publication_path(@publication), alert: error.message
    end

    def publish
      @publication.publish!(expected_revision: params[:revision], expected_lock_version: params[:lock_version])
      redirect_to admin_publications_path, notice: "Publication published. Members can now read the reviewed version."
    rescue Publication::InvalidTransition => error
      redirect_to edit_admin_publication_path(@publication), alert: error.message
    end

    private

    def set_publication
      @publication = Publication.find_by!(slug: params[:id])
    end

    def update_draft
      attributes = params.require(:publication).permit(*Publication::FIELDS, :lock_version, :pdf, :cover, :remove_pdf, :remove_cover)
      success = PublicationDraftUpdater.new(@publication).call(
        attributes: attributes.slice(*Publication::FIELDS).to_h,
        pdf: attributes[:pdf], cover: attributes[:cover],
        remove_pdf: attributes[:remove_pdf] == "1", remove_cover: attributes[:remove_cover] == "1",
        expected_lock_version: attributes[:lock_version]
      )
      if success && params[:intent] == "preview"
        begin
          @publication.prepare_preview!(expected_lock_version: @publication.lock_version)
          redirect_to preview_admin_publication_path(@publication)
        rescue Publication::InvalidTransition
          render :edit, status: :unprocessable_entity
        end
      elsif success
        redirect_to admin_publications_path, notice: @publication.published? ? "Draft saved. Members continue to see the previous published version." : "Draft saved. Review it before publishing to members."
      else
        render :edit, status: :unprocessable_entity
      end
    end
  end
end

module Admin
  class EventsController < ApplicationController
    before_action :require_admin
    before_action :set_event, only: %i[edit update preview prepare_preview publish]
    def index
      @events = Event.order(updated_at: :desc)
    end
    def new
      @event = Event.new
      @event.valid?
    end
    def create
      params.require(:event)
      @event = Event.create!
      params[:event][:lock_version] = @event.lock_version
      update_draft
    end
    def edit; end
    def update
      update_draft
    end
    def preview
      return redirect_to edit_admin_event_path(@event), alert: "The draft has changed. Create a fresh preview first." unless @event.preview_current?
      @data = @event.preview_data
    end
    def prepare_preview
      @event.prepare_preview!
      redirect_to preview_admin_event_path(@event)
    rescue Event::InvalidTransition => error
      redirect_to edit_admin_event_path(@event), alert: error.message
    end
    def publish
      @event.publish!(expected_revision: params[:revision])
      redirect_to event_path(@event), notice: "Published in this demo. This exact reviewed version is now public."
    rescue Event::InvalidTransition => error
      redirect_to edit_admin_event_path(@event), alert: error.message
    end
    private
    def set_event
      @event = Event.find_by!(slug: params[:id])
    end
    def update_draft
      attributes = params.require(:event).permit(*Event::FIELDS, :lock_version, :brochure, :remove_brochure, images: [], remove_images: [])
      success = EventDraftUpdater.new(@event).call(attributes: attributes.slice(*Event::FIELDS), images: attributes[:images], brochure: attributes[:brochure], remove_images: Array(attributes[:remove_images]), remove_brochure: attributes[:remove_brochure] == "1", expected_lock_version: attributes[:lock_version])
      if success && params[:intent] == "preview"
        begin
          @event.prepare_preview!
          redirect_to preview_admin_event_path(@event)
        rescue Event::InvalidTransition
          render :edit, status: :unprocessable_entity
        end
      elsif success
        redirect_to admin_events_path, notice: "Draft saved. It stays private until a reviewed version is published."
      else
        render :edit, status: :unprocessable_entity
      end
    end
  end
end

module Admin
  class EventsController < ApplicationController
    before_action :require_admin
    before_action :set_event, only: %i[edit update preview prepare_preview publish]
    before_action :require_editor_verification, only: %i[new create edit update prepare_preview publish]
    rescue_from AdministrativeAction::VerificationRequired, with: :render_editor_verification
    rescue_from AdministrativeAction::Unauthorized, with: :render_revoked_administrator
    rescue_from AdministrativeAction::AuditFailure, with: :render_audit_failure
    rescue_from UploadOperation::StorageFailure, with: :render_audit_failure

    def index
      @events = Event.order(updated_at: :desc)
    end
    def new
      @event = Event.new
      @event.valid?
    end
    def create
      params.require(:event)
      @event = Event.new
      @event.valid?
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
      AdministrativeAction.call(actor: current_user, authentication: current_user_session, target: @event, action: "event_publish") do
        @event.publish!(expected_revision: params[:revision])
        true
      end
      redirect_to event_path(@event), notice: demo_mode? ? "Published in this demo. This exact reviewed version is now public." : "Event published. This exact reviewed version is now public."
    rescue Event::InvalidTransition => error
      redirect_to edit_admin_event_path(@event), alert: error.message
    end

    private

    def set_event
      @event = Event.find_by!(slug: params[:id])
    end
    def require_editor_verification
      render_editor_verification unless fresh_admin_verification?
    end
    def render_editor_verification(_error = nil)
      if request.get? || request.head?
        return redirect_to admin_verification_path(return_to: safe_return_path(request.fullpath))
      end
      @admin_verification_required = true
      rebuild_submitted_draft
      @event.errors.add(:base, "Verify your administrator access before saving or publishing. Nothing was saved.")
      @data = @event.preview_data || @event.draft_data
      render action_name == "publish" ? :preview : :edit, status: :unprocessable_entity
    end
    def rebuild_submitted_draft
      @event ||= Event.new
      @event.valid?
      if params[:event].respond_to?(:permit)
        @submitted_lock_version = params[:event].permit(:lock_version)[:lock_version]
        values = params[:event].permit(*Event::FIELDS).to_h.transform_values(&:to_s)
        @event.draft_data = (@event.draft_data || {}).merge(values)
      end
    end
    def render_revoked_administrator
      render "shared/forbidden", status: :forbidden
    end
    def render_audit_failure(error)
      @event.reload if @event&.persisted?
      rebuild_submitted_draft
      @event.errors.add(:base, error.message)
      @data = @event.preview_data || @event.draft_data
      flash.now[:alert] = error.message
      render action_name == "publish" ? :preview : :edit, status: :unprocessable_entity
    end
    def update_draft
      attributes = params.require(:event).permit(*Event::FIELDS, :lock_version, :brochure, :remove_brochure, images: [], remove_images: [])
      @submitted_lock_version = attributes[:lock_version]
      operation = UploadOperation.for_event(@event, images: attributes[:images],
        brochure: attributes[:brochure], remove_images: Array(attributes[:remove_images]))
      success = operation.run do |uploads|
        AdministrativeAction.call(actor: current_user, authentication: current_user_session, target: @event, action: "event_draft_update") do
          @event.save! if @event.new_record?
          EventDraftUpdater.new(@event).call(attributes: attributes.slice(*Event::FIELDS),
            remove_images: Array(attributes[:remove_images]),
            remove_brochure: attributes[:remove_brochure] == "1",
            expected_lock_version: attributes[:lock_version], uploads: uploads)
        end
      end
      @submitted_lock_version = @event.lock_version if success
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

module Admin
  class PublicationsController < ApplicationController
    before_action :require_admin
    before_action :set_publication, only: %i[edit update preview prepare_preview publish]
    before_action :require_editor_verification, only: %i[new create edit update prepare_preview publish]
    rescue_from AdministrativeAction::VerificationRequired, with: :render_editor_verification
    rescue_from AdministrativeAction::Unauthorized, with: :render_revoked_administrator
    rescue_from AdministrativeAction::AuditFailure, with: :render_audit_failure
    rescue_from UploadOperation::StorageFailure, with: :render_audit_failure

    def index
      @publications = Publication.order(updated_at: :desc)
    end
    def new
      @publication = Publication.new
      @publication.valid?
    end
    def create
      params.require(:publication)
      @publication = Publication.new
      @publication.valid?
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
      AdministrativeAction.call(actor: current_user, authentication: current_user_session, target: @publication, action: "publication_publish") do
        @publication.publish!(expected_revision: params[:revision], expected_lock_version: params[:lock_version])
        true
      end
      redirect_to admin_publications_path, notice: "Publication published. Members can now read the reviewed version."
    rescue Publication::InvalidTransition => error
      redirect_to edit_admin_publication_path(@publication), alert: error.message
    end

    private

    def set_publication
      @publication = Publication.find_by!(slug: params[:id])
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
      @publication.errors.add(:base, "Verify your administrator access before saving or publishing. Nothing was saved.")
      @data = @publication.preview_data || @publication.draft_data
      render action_name == "publish" ? :preview : :edit, status: :unprocessable_entity
    end
    def rebuild_submitted_draft
      @publication ||= Publication.new
      @publication.valid?
      if params[:publication].respond_to?(:permit)
        @submitted_lock_version = params[:publication].permit(:lock_version)[:lock_version]
        values = params[:publication].permit(*Publication::FIELDS).to_h.transform_values(&:to_s)
        @publication.draft_data = (@publication.draft_data || {}).merge(values)
      end
    end
    def render_revoked_administrator
      render "shared/forbidden", status: :forbidden
    end
    def render_audit_failure(error)
      request.env["isp.exception_class"] = error.class.name
      @publication.reload if @publication&.persisted?
      rebuild_submitted_draft
      @publication.errors.add(:base, error.message)
      @data = @publication.preview_data || @publication.draft_data
      flash.now[:alert] = error.message
      render action_name == "publish" ? :preview : :edit, status: :unprocessable_entity
    end
    def update_draft
      attributes = params.require(:publication).permit(*Publication::FIELDS, :lock_version, :pdf, :cover, :remove_pdf, :remove_cover)
      @submitted_lock_version = attributes[:lock_version]
      operation = UploadOperation.for_publication(pdf: attributes[:pdf], cover: attributes[:cover])
      request.env["isp.upload_operation_id"] = operation.id
      success = operation.run do |uploads|
        AdministrativeAction.call(actor: current_user, authentication: current_user_session, target: @publication, action: "publication_draft_update") do
          @publication.save! if @publication.new_record?
          PublicationDraftUpdater.new(@publication).call(attributes: attributes.slice(*Publication::FIELDS).to_h,
            remove_pdf: attributes[:remove_pdf] == "1", remove_cover: attributes[:remove_cover] == "1",
            expected_lock_version: attributes[:lock_version], uploads: uploads)
        end
      end
      @submitted_lock_version = @publication.lock_version if success
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

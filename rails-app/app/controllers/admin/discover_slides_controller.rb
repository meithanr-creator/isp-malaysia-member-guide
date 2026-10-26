module Admin
  class DiscoverSlidesController < ApplicationController
    before_action :require_admin
    before_action :require_fresh_verification, only: %i[setup update]

    def index
      @slides = DiscoverSlide.ordered
    end

    # Fixed, shipped content only. ON CONFLICT DO NOTHING preserves every saved
    # card and makes simultaneous fresh-database setup requests idempotent.
    def setup
      AdministrativeAction.call(actor: current_user, authentication: current_user_session,
        target: "DiscoverConfiguration", action: "discover_setup", revision: 1) do
        now = Time.current
        DiscoverSlide.insert_all(DiscoverSlide::DEFAULTS.map { |attributes| attributes.merge(created_at: now, updated_at: now) }, unique_by: :position)
        true
      end
      redirect_to admin_discover_path, notice: "Discover cards are ready. Review each card's text, image and website before launch. Existing cards were preserved."
    rescue AdministrativeAction::VerificationRequired => error
      render_action_failure(error, verification: true)
    rescue AdministrativeAction::AuditFailure => error
      render_action_failure(error)
    rescue AdministrativeAction::Unauthorized => error
      reject_changed_administrator(error)
    end

    def update
      @slide = DiscoverSlide.find(params[:id])
      attributes = params.require(:discover_slide).permit(:tag, :title, :description, :website_url, :image_alt, :image, :lock_version)
      operation = UploadOperation.for_discover(image: attributes[:image])
      request.env["isp.upload_operation_id"] = operation.id
      saved = operation.run do |uploads|
        AdministrativeAction.call(actor: current_user, authentication: current_user_session,
          target: @slide, action: "discover_update") do
          DiscoverSlideUpdater.new(@slide).call(attributes: attributes.slice(:tag, :title, :description, :website_url, :image_alt).to_h,
            expected_lock_version: attributes[:lock_version], uploads: uploads)
        end
      end
      if saved
        redirect_to admin_discover_path(anchor: "discover-card-#{@slide.id}"), notice: "Discover card #{@slide.position} saved. The homepage now shows this version."
      else
        @slides = DiscoverSlide.ordered.map { |slide| slide.id == @slide.id ? @slide : slide }
        render :index, status: :unprocessable_entity
      end
    rescue UploadOperation::StorageFailure => error
      render_action_failure(error)
    rescue AdministrativeAction::VerificationRequired => error
      render_action_failure(error, verification: true)
    rescue AdministrativeAction::AuditFailure => error
      render_action_failure(error)
    rescue AdministrativeAction::Unauthorized => error
      reject_changed_administrator(error)
    end

    private

    def require_fresh_verification
      return if fresh_admin_verification?
      render_action_failure(nil, verification: true)
    end

    def render_action_failure(error, verification: false)
      request.env["isp.exception_class"] = error.class.name if error
      @admin_verification_required = verification
      flash.now[:alert] = error.message if error && !verification
      @slides = DiscoverSlide.ordered.to_a
      if action_name == "update" && params[:discover_slide].is_a?(ActionController::Parameters)
        submitted = params[:discover_slide]
        slide = @slides.find { |item| item.id.to_s == params[:id].to_s }
        if slide
          slide.assign_attributes(submitted.permit(:tag, :title, :description, :website_url, :image_alt).to_h)
          # Keep the submitted edit version: verification must not silently turn
          # stale text into permission to overwrite a newer saved card.
          token = submitted[:lock_version].to_s
          slide.lock_version = token.to_i if token.match?(/\A\d+\z/)
        end
      end
      render :index, status: :unprocessable_entity
    end

    def reject_changed_administrator(error)
      UserSession.revoke_token(session[:authentication_token])
      reset_session
      redirect_to login_path, alert: error.message
    end
  end
end

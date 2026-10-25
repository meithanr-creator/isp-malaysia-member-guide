module Admin
  class MembershipImportsController < ApplicationController
    before_action :require_admin
    before_action :set_import, only: %i[show confirm]

    def new; end

    def create
      upload = params[:membership_import].is_a?(ActionController::Parameters) ? params[:membership_import][:csv] : nil
      @import = MembershipRegistryImporter.new.prepare!(upload: upload, actor: current_user)
      redirect_to admin_membership_import_path(@import)
    rescue MembershipRegistryImporter::InvalidConfirmation => error
      redirect_to new_admin_membership_import_path, alert: error.message
    end

    def show
      @rows = @import.registry_rows.slice((@page - 1) * 50, 50) || []
      @page_count = [(@import.registry_rows.length / 50.0).ceil, 1].max
    end

    def confirm
      MembershipRegistryImporter.new.confirm!(import: @import, actor: current_user,
        digest: params[:digest], registry_version: params[:registry_version])
      redirect_to admin_membership_import_path(@import), notice: "Membership list confirmed. No accounts were activated and no invitations were sent."
    rescue MembershipRegistryImporter::InvalidConfirmation => error
      redirect_to admin_membership_import_path(@import), alert: error.message
    end

    private

    def set_import
      MembershipImport.expire_previews!
      @import = MembershipImport.where(actor_id: current_user.id).find_by!(public_id: params[:id])
      @page = [params[:page].to_s.first(6).to_i, 1].max
    end
  end
end


module Admin
  class MembershipRegistryEntriesController < ApplicationController
    before_action :require_admin

    def index
      MembershipImport.expire_previews!
      @page = [params[:page].to_s.first(6).to_i, 1].max
      @total = MembershipRegistryEntry.count
      @entries = MembershipRegistryEntry.includes(:user).order(:member_reference).limit(50).offset((@page - 1) * 50)
      @recent_imports = MembershipImport.where(actor_id: current_user.id).order(created_at: :desc).limit(10)
    end
  end
end


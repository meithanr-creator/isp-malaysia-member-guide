module Admin
  class AccountInvitationsController < ApplicationController
    include AuthenticationResponse
    before_action :require_admin

    def create
      unless LoginAttemptBucket.allowed?(email: current_user.id.to_s, ip: request.remote_ip, purpose: "invitation")
        return redirect_to admin_membership_registry_entries_path, alert: "Please wait before requesting more invitations."
      end
      result = AccountInvitation.call(entry: MembershipRegistryEntry.find(params[:id]), actor: current_user)
      if result.success?
        redirect_to admin_membership_registry_entries_path, notice: "The activation invitation was sent. This member must verify the link and choose a password."
      else
        redirect_to admin_membership_registry_entries_path, alert: result.error
      end
    end
  end
end

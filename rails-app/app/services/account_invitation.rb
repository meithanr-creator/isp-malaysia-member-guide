class AccountInvitation
  Result = Data.define(:success?, :error)

  def self.call(entry:, actor:, deliver: ->(record) { AccountMailer.activation(record.id).deliver_now })
    return Result.new(false, "Account email is not enabled. No invitation was sent.") unless AccountMailer.enabled?
    record = raw_token = invited = nil
    registry = MembershipRegistryState.current
    registry.with_lock do
      actor.reload
      raise ActiveRecord::RecordInvalid, actor unless actor.admin? && actor.login_allowed?
      entry.reload
      return Result.new(false, "This member is not eligible for invitation.") unless entry.eligible?
      invited = entry.user
      if invited.nil?
        return Result.new(false, "This email already belongs to another account. Review the registry identity.") if User.exists?(email: entry.email)
        invited = User.create!(name: entry.name, email: entry.email, password: SecureRandom.hex(32), role: "member", account_status: "pending")
        entry.update!(user: invited)
        registry.advance!
      end
      invited.with_lock do
        return Result.new(false, "Only a pending account with this registry email can be invited.") unless invited.member? && invited.email == entry.email && invited.account_status == "pending"
        record, raw_token = AccountToken.issue(invited, purpose: "activation")
      end
    end
    begin
      deliver.call(record)
      record.update!(delivery_status: "sent", delivery_token: nil)
      AccountSecurityEvent.create!(user: invited, actor: actor, action: "invitation", outcome: "sent")
      Result.new(true, nil)
    rescue StandardError
      record.update!(delivery_status: "failed", consumed_at: Time.current, delivery_token: nil)
      AccountSecurityEvent.create!(user: invited, actor: actor, action: "invitation", outcome: "delivery_failed")
      Result.new(false, "The invitation could not be sent. The account remains pending. Retry after email service is restored.")
    end
  end
end

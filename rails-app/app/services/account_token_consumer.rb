class AccountTokenConsumer
  Result = Data.define(:success?, :user, :error)

  def self.call(token:, purpose:, password:, password_confirmation:)
    record = AccountToken.lookup(token, purpose: purpose)
    return Result.new(false, nil, "This link has expired or is unavailable. Request a new link.") unless record
    result = nil
    registry = MembershipRegistryState.current
    registry.with_lock do
      user = record.user
      user.with_lock do
        record.lock!
        eligible = user.admin? || (user.membership_registry_entry&.eligible? && user.membership_registry_entry.email == user.email)
        allowed = purpose == "activation" ? user.account_status == "pending" && eligible : user.password_login_allowed?
        if !record.usable? || !allowed || (Rails.env.production? && user.sample_identity?)
          result = Result.new(false, nil, "This link has expired or is unavailable. Request a new link.")
        else
          user.assign_attributes(password: password.to_s, password_confirmation: password_confirmation.to_s)
          user.assign_attributes(account_status: "active", email_verified_at: Time.current) if purpose == "activation"
          if user.save
            record.update!(consumed_at: Time.current)
            user.account_tokens.where(consumed_at: nil).update_all(consumed_at: Time.current, delivery_token: nil)
            registry.advance! if purpose == "activation" && user.member?
            AccountSecurityEvent.create!(user: user, action: purpose, outcome: "success")
            result = Result.new(true, user, nil)
          else
            result = Result.new(false, user, user.errors.full_messages.to_sentence)
          end
        end
      end
    end
    result
  end
end

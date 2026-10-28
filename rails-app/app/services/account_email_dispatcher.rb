class AccountEmailDispatcher
  LEASE_TIMEOUT = 5.minutes
  MAX_BATCH = 50
  Result = Data.define(:sent, :failed, :enabled?)

  def self.call(limit: 20, deliver: ->(record) { AccountMailer.recovery(record.id).deliver_now })
    return Result.new(0, 0, false) unless AccountMailer.enabled? && ENV["ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED"] == "true"
    cleanup!
    sent = failed = 0
    AccountToken.where(purpose: "recovery", delivery_status: "queued").where("expires_at > ?", Time.current)
      .order(:id).limit([[limit.to_i, 1].max, MAX_BATCH].min).each do |record|
      lease = claim(record)
      next unless lease
      begin
        deliver.call(record)
        if complete(record, lease)
          AccountSecurityEvent.create!(user: record.user, action: "recovery_email", outcome: "sent")
          sent += 1
        else
          AccountSecurityEvent.create!(user: record.user, action: "recovery_email", outcome: "delivery_unconfirmed")
          failed += 1
        end
      rescue StandardError
        owned_lease(record, lease).update_all(delivery_status: "failed", consumed_at: Time.current, delivery_token: nil)
        AccountSecurityEvent.create!(user: record.user, action: "recovery_email", outcome: "delivery_failed")
        failed += 1
      end
    end
    Result.new(sent, failed, true)
  end

  def self.claim(record)
    record.with_lock do
      # A competing dispatcher may already own this enumerated row.
      return unless record.delivery_status == "queued"
      unless record.expires_at > Time.current && record.consumed_at.nil? &&
          record.authentication_fingerprint == record.user.authentication_fingerprint && record.user.password_login_allowed?
        record.update!(delivery_status: "failed", consumed_at: Time.current, delivery_token: nil)
        return
      end
      record.update!(delivery_status: "dispatching", delivery_lease_at: Time.current)
      record.delivery_lease_at
    end
  end

  def self.complete(record, lease)
    owned_lease(record, lease).where(consumed_at: nil).where("expires_at > ?", Time.current)
      .update_all(delivery_status: "sent", delivery_token: nil) == 1
  end

  def self.owned_lease(record, lease)
    AccountToken.where(id: record.id, delivery_status: "dispatching", delivery_lease_at: lease)
  end
  private_class_method :owned_lease

  def self.cleanup!
    now = Time.current
    AccountToken.where(delivery_status: "dispatching").where("delivery_lease_at <= ?", now - LEASE_TIMEOUT)
      .limit(MAX_BATCH).update_all(delivery_status: "failed", consumed_at: now, delivery_token: nil)
    AccountToken.where(delivery_status: "queued").where("expires_at <= ?", now).limit(MAX_BATCH)
      .update_all(delivery_status: "failed", consumed_at: now, delivery_token: nil)
    AccountToken.where.not(delivery_token: nil).where("expires_at <= ? OR consumed_at IS NOT NULL", now).limit(MAX_BATCH)
      .update_all(delivery_token: nil)
  end
end

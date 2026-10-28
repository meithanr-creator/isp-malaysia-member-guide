class AccountMailer < ApplicationMailer
  def self.enabled?
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] == "true" && ActionMailer::Base.perform_deliveries
  end

  def activation(record_id)
    record = delivery_record(record_id, "activation")
    @user = record.user
    @account_url = activation_url(anchor: "token=#{record.delivery_token}")
    mail(to: @user.email, from: sender, subject: "Activate your ISP account")
  end

  def recovery(record_id)
    record = delivery_record(record_id, "recovery")
    @user = record.user
    @account_url = password_recovery_reset_url(anchor: "token=#{record.delivery_token}")
    mail(to: @user.email, from: sender, subject: "Reset your ISP account password")
  end

  private

  def sender = ENV.fetch("MAIL_FROM", "local-review@example.test")

  def delivery_record(id, purpose)
    record = AccountToken.find(id)
    unless record.purpose == purpose && record.consumed_at.nil? && record.expires_at > Time.current && record.delivery_token.present?
      raise ArgumentError, "Account delivery is no longer available."
    end
    record
  end

  # Default Rails debug logs contain encoded mail. Account mail never does.
  def self.set_payload_for_mail(payload, mail)
    super
    payload[:mail] = "[Account email content redacted]"
    %i[to from cc bcc subject].each { |key| payload.delete(key) }
  end
  private_class_method :set_payload_for_mail
end

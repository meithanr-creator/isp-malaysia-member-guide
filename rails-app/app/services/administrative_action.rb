class AdministrativeAction
  class Unauthorized < StandardError; end
  class VerificationRequired < StandardError; end
  class AuditFailure < StandardError; end
  FRESHNESS = 10.minutes

  def self.call(actor:, authentication:, target:, action:, revision: nil)
    completed = false
    ApplicationRecord.transaction(requires_new: true) do
      actor.lock!
      session = authentication && UserSession.lock.find_by(id: authentication.id, user_id: actor.id)
      now = Time.current
      valid = actor.admin? && actor.login_allowed? && session && session.expires_at > now &&
        session.last_seen_at > now - UserSession::IDLE_TIMEOUT && session.authentication_fingerprint == actor.authentication_fingerprint
      raise Unauthorized, "Administrator access is no longer available." unless valid
      if actor.admin_mfa_required? && (!session.mfa_verified_at || session.mfa_verified_at <= now - FRESHNESS)
        raise VerificationRequired, "Verify your administrator access before saving or publishing."
      end
      target.lock! if target.is_a?(ApplicationRecord) && target.persisted?
      result = yield
      raise ActiveRecord::Rollback unless result
      target_revision = revision || (target.respond_to?(:revision) ? target.revision : target.try(:lock_version)) || 0
      begin
        AdministrativeAudit.create!(actor: actor, target_type: target.is_a?(String) ? target : target.class.name,
          target_id: target.try(:id), revision: target_revision, action: action, outcome: "success", occurred_at: Time.current)
      rescue ActiveRecord::RecordInvalid => error
        raise AuditFailure, "The change could not be recorded. Nothing was saved."
      end
      completed = true
    end
    completed
  end
end

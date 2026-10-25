class MembershipImport < ApplicationRecord
  PREVIEW_LIFETIME = 15.minutes

  belongs_to :actor, class_name: "User"
  has_many :membership_registry_audits, dependent: :restrict_with_exception
  before_validation :assign_public_id, on: :create
  validates :public_id, :digest, :registry_fingerprint, :expires_at, presence: true
  validates :state, inclusion: { in: %w[ready invalid confirmed expired] }

  def to_param = public_id
  def confirmed? = state == "confirmed"
  def ready? = state == "ready" && expires_at > Time.current

  # Expiry removes normalized private preview data as well as preventing use.
  # Run membership_imports:expire routinely in an approved hosted environment.
  def self.expire_previews!
    where(state: %w[ready invalid]).where("expires_at <= ?", Time.current)
      .update_all(state: "expired", registry_rows: [], validation_errors: [], updated_at: Time.current)
  end

  private

  def assign_public_id
    self.public_id ||= SecureRandom.uuid
  end
end

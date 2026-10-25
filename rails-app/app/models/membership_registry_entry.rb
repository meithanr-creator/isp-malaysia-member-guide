class MembershipRegistryEntry < ApplicationRecord
  belongs_to :user, optional: true

  normalizes :email, with: ->(email) { email.strip.downcase }
  normalizes :member_reference, with: ->(reference) { reference.strip }
  validates :name, presence: true, length: { maximum: 80 }
  validates :email, presence: true, uniqueness: true, length: { maximum: 160 }, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :member_reference, presence: true, uniqueness: true, length: { maximum: 80 }
  validates :status, inclusion: { in: %w[eligible ineligible] }
  validates :user_id, uniqueness: true, allow_nil: true
  validate :linked_identity_matches

  def eligible? = status == "eligible"

  private

  def linked_identity_matches
    return unless user
    errors.add(:user, "must be a member with the registry email") unless user.member? && user.email == email
    if persisted? && (will_save_change_to_email? || will_save_change_to_member_reference?)
      errors.add(:base, "Linked membership identity cannot be reassigned")
    end
  end
end

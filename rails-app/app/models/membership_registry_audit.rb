# Contains references and eligibility changes, never raw CSV, passwords or tokens.
class MembershipRegistryAudit < ApplicationRecord
  self.filter_attributes += [:eligibility_changes]
  belongs_to :membership_import
  belongs_to :actor, class_name: "User"
  validates :action, inclusion: { in: %w[preview preview_rejected confirmed] }
  validates :digest, :occurred_at, presence: true
end



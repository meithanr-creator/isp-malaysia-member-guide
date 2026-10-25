class AdministrativeAudit < ApplicationRecord
  belongs_to :actor, class_name: "User"
  validates :target_type, :action, :outcome, :occurred_at, presence: true
  validates :revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end

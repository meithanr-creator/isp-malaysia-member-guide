class AccountSecurityEvent < ApplicationRecord
  belongs_to :user, optional: true
  belongs_to :actor, class_name: "User", optional: true
  validates :action, :outcome, presence: true
end

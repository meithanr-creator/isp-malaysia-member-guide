class RenameMembershipAuditChanges < ActiveRecord::Migration[8.1]
  def change
    rename_column :membership_registry_audits, :changes, :eligibility_changes
  end
end

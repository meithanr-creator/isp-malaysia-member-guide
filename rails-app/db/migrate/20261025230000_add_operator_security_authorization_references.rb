class AddOperatorSecurityAuthorizationReferences < ActiveRecord::Migration[8.1]
  def change
    add_column :account_security_events, :authorization_reference, :string
    add_column :account_security_events, :operator_reference, :string
  end
end

class AddMfaRecoveryDisplayAndSecurityEvents < ActiveRecord::Migration[8.1]
  def change
    add_column :authentication_challenges, :recovery_codes, :text
    add_column :authentication_challenges, :codes_viewed_at, :datetime
    create_table :account_security_events do |t|
      t.references :user, foreign_key: { on_delete: :nullify }
      t.references :actor, foreign_key: { to_table: :users, on_delete: :nullify }
      t.string :action, null: false
      t.string :outcome, null: false
      t.datetime :created_at, null: false
    end
  end
end

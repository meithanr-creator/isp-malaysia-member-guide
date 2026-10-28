class AddAccountRecoveryAndMfa < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :email_verified_at, :datetime
    add_column :users, :otp_secret, :text
    add_column :users, :otp_enabled_at, :datetime
    add_column :users, :otp_last_used_at, :datetime
    add_column :users, :recovery_code_digests, :text
    add_column :user_sessions, :mfa_verified_at, :datetime

    create_table :account_tokens do |t|
      t.references :user, null: false, foreign_key: true
      t.string :purpose, null: false
      t.string :token_digest, null: false
      t.string :authentication_fingerprint, null: false
      t.datetime :expires_at, null: false
      t.datetime :consumed_at
      t.string :delivery_status, null: false, default: "pending"
      t.timestamps
      t.index :token_digest, unique: true
      t.index [:user_id, :purpose]
      t.index :expires_at
    end
    add_check_constraint :account_tokens, "purpose IN ('activation', 'recovery')", name: "account_tokens_purpose_valid"

    create_table :authentication_challenges do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token_digest, null: false
      t.string :authentication_fingerprint, null: false
      t.text :otp_secret
      t.datetime :expires_at, null: false
      t.datetime :consumed_at
      t.timestamps
      t.index :token_digest, unique: true
      t.index :expires_at
    end
  end
end

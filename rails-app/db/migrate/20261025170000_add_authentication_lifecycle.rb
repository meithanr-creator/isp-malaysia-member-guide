class AddAuthenticationLifecycle < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :account_status, :string, null: false, default: "pending"
    add_check_constraint :users, "account_status IN ('pending', 'active', 'suspended')", name: "users_account_status_valid"

    # Only preserve the two public fictional local-review accounts.
    unless Rails.env.production?
      execute "UPDATE users SET account_status = 'active' WHERE email IN ('member@example.com', 'admin@example.com')"
    end

    create_table :user_sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token_digest, null: false
      t.string :authentication_fingerprint, null: false
      t.datetime :last_seen_at, null: false
      t.datetime :expires_at, null: false
      t.timestamps
      t.index :token_digest, unique: true
      t.index :expires_at
      t.index :last_seen_at
    end

    create_table :login_attempt_buckets do |t|
      t.string :scope_digest, null: false
      t.datetime :window_started_at, null: false
      t.datetime :expires_at, null: false
      t.integer :attempts, null: false, default: 0
      t.index [:scope_digest, :window_started_at], unique: true
      t.index :expires_at
    end
  end

  def down
    drop_table :login_attempt_buckets
    drop_table :user_sessions
    remove_check_constraint :users, name: "users_account_status_valid"
    remove_column :users, :account_status
  end
end

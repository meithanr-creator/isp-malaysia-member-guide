class CreateMembershipRegistry < ActiveRecord::Migration[8.1]
  def change
    create_table :membership_registry_states do |t|
      t.integer :revision, null: false, default: 0
      t.timestamps
    end
    reversible do |direction|
      direction.up do
        execute "INSERT INTO membership_registry_states (id, revision, created_at, updated_at) VALUES (1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      end
    end

    create_table :membership_registry_entries do |t|
      t.string :name, null: false, limit: 80
      t.string :email, null: false, limit: 160
      t.string :member_reference, null: false, limit: 80
      t.string :status, null: false
      t.references :user, foreign_key: true, index: { unique: true }
      t.timestamps
      t.index :email, unique: true
      t.index :member_reference, unique: true
    end
    add_check_constraint :membership_registry_entries, "status IN ('eligible', 'ineligible')", name: "membership_registry_status_valid"
    add_check_constraint :membership_registry_entries, "email = LOWER(TRIM(email))", name: "membership_registry_email_normalized"

    create_table :membership_imports do |t|
      t.string :public_id, null: false
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :state, null: false
      t.json :registry_rows, null: false, default: []
      t.json :validation_errors, null: false, default: []
      t.json :counts, null: false, default: {}
      t.string :digest, null: false
      t.integer :registry_version, null: false
      t.string :registry_fingerprint, null: false
      t.datetime :expires_at, null: false
      t.datetime :confirmed_at
      t.timestamps
      t.index :public_id, unique: true
      t.index :expires_at
    end
    add_check_constraint :membership_imports, "state IN ('ready', 'invalid', 'confirmed', 'expired')", name: "membership_import_state_valid"

    create_table :membership_registry_audits do |t|
      t.references :membership_import, null: false, foreign_key: true
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :action, null: false
      t.string :digest, null: false
      t.json :counts, null: false, default: {}
      t.json :changes, null: false, default: []
      t.datetime :occurred_at, null: false
      t.timestamps
      t.index [:membership_import_id, :action], unique: true, name: "index_membership_audits_on_import_and_action"
    end
  end
end



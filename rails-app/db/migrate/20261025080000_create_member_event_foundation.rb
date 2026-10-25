class CreateMemberEventFoundation < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :email, null: false
      t.string :password_digest, null: false
      t.string :name, null: false
      t.string :role, null: false, default: "member"
      t.string :company
      t.string :branch
      t.string :phone
      t.timestamps
    end
    add_index :users, :email, unique: true
    create_table :events do |t|
      t.string :slug, null: false
      t.text :draft_data
      t.text :preview_data
      t.text :published_data
      t.integer :revision, default: 0, null: false
      t.integer :preview_revision
      t.datetime :published_at
      t.integer :lock_version, default: 0, null: false
      t.timestamps
    end
    add_index :events, :slug, unique: true
    create_table :event_interests do |t|
      t.references :user, foreign_key: true, null: false
      t.references :event, foreign_key: true, null: false
      t.string :name, null: false
      t.string :email, null: false
      t.string :company
      t.integer :event_revision
      t.text :event_snapshot
      t.timestamps
    end
    add_index :event_interests, %i[user_id event_id], unique: true
  end
end

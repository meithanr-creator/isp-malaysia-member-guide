class CreatePublications < ActiveRecord::Migration[8.1]
  def change
    create_table :publications do |t|
      t.string :slug, null: false
      t.text :draft_data
      t.text :preview_data
      t.text :published_data
      t.integer :revision, default: 0, null: false
      t.integer :preview_revision
      t.integer :published_revision
      t.datetime :published_at
      t.integer :lock_version, default: 0, null: false
      t.timestamps
    end
    add_index :publications, :slug, unique: true
  end
end

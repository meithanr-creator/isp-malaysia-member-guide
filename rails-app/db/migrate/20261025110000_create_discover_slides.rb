class CreateDiscoverSlides < ActiveRecord::Migration[8.1]
  def change
    create_table :discover_slides do |t|
      t.integer :position, null: false
      t.string :tag, null: false
      t.string :title, null: false
      t.text :description, null: false
      t.string :website_url, null: false
      t.string :image_alt, null: false
      t.string :default_image, null: false
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end
    add_index :discover_slides, :position, unique: true
  end
end

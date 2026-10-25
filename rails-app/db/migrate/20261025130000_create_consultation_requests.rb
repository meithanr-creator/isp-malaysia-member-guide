class CreateConsultationRequests < ActiveRecord::Migration[8.1]
  def change
    create_table :consultation_requests do |t|
      t.references :user, null: false, foreign_key: true
      t.string :category, null: false
      t.string :subject, null: false
      t.text :message, null: false
      t.string :request_key, null: false
      t.timestamps
    end
    add_index :consultation_requests, [:user_id, :request_key], unique: true
  end
end

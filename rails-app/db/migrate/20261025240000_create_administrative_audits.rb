class CreateAdministrativeAudits < ActiveRecord::Migration[8.1]
  def change
    create_table :administrative_audits do |t|
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :target_type, null: false
      t.bigint :target_id
      t.integer :revision, null: false
      t.string :action, null: false
      t.string :outcome, null: false
      t.datetime :occurred_at, null: false
      t.index [:target_type, :target_id]
    end
  end
end

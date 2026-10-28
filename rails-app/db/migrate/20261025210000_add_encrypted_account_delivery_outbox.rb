class AddEncryptedAccountDeliveryOutbox < ActiveRecord::Migration[8.1]
  def change
    add_column :account_tokens, :delivery_token, :text
    add_column :account_tokens, :delivery_lease_at, :datetime
    add_index :account_tokens, [:purpose, :delivery_status]
  end
end

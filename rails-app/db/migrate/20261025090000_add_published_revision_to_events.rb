class AddPublishedRevisionToEvents < ActiveRecord::Migration[8.1]
  def change
    add_column :events, :published_revision, :integer
    reversible do |direction|
      direction.up { execute "UPDATE events SET published_revision = revision WHERE published_at IS NOT NULL" }
    end
  end
end

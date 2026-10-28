# Every registry/import/activation write must share this database lock. The
# revision binds a preview to a particular membership-authority version.
class MembershipRegistryState < ApplicationRecord
  def self.current
    find_or_create_by!(id: 1)
  end

  def advance!
    update!(revision: revision + 1)
  end

  def self.fingerprint
    data = {
      entries: MembershipRegistryEntry.order(:id).pluck(:id, :name, :email, :member_reference, :status, :user_id, :updated_at),
      users: User.order(:id).pluck(:id, :email, :role, :account_status, :updated_at)
    }
    Digest::SHA256.hexdigest(data.to_json)
  end
end


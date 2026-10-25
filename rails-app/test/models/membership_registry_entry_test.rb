require "test_helper"

class MembershipRegistryEntryTest < ActiveSupport::TestCase
  test "normalization preserves membership references as strings with database uniqueness" do
    entry = MembershipRegistryEntry.create!(name: "Fictional Member", email: " MEMBER@example.test ", member_reference: "000012", status: "eligible")
    assert_equal "member@example.test", entry.email
    assert_equal "000012", entry.member_reference
    duplicate = MembershipRegistryEntry.new(name: "Other Fictional", email: "Member@example.test", member_reference: "000013", status: "eligible")
    refute duplicate.valid?
    assert duplicate.errors[:email].any?
    duplicate.email = "other@example.test"
    duplicate.member_reference = "000012"
    refute duplicate.valid?
    assert duplicate.errors[:member_reference].any?
  end

  test "a linked membership cannot be reassigned or linked to an administrator" do
    member = create_member
    entry = MembershipRegistryEntry.create!(name: member.name, email: member.email, member_reference: "000012", status: "eligible", user: member)
    refute entry.update(member_reference: "000013")
    entry.reload
    refute entry.update(email: "someone-else@example.test")
    entry.reload
    admin = create_member(role: "admin")
    entry.user = admin
    refute entry.valid?
  end
end

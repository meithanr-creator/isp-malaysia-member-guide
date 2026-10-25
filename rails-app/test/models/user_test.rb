require "test_helper"

class UserTest < ActiveSupport::TestCase
  test "email normalization supports password authentication" do
    member = create_member(email: " ALEX@EXAMPLE.TEST ")
    assert_equal "alex@example.test", member.reload.email
    assert member.authenticate("test-password-2026")
    assert_not member.authenticate("wrong-password")
  end

  test "only supported roles can be persisted" do
    user = User.new(member_attributes(role: "owner"))
    assert_not user.valid?
    assert user.errors[:role].present?
  end

  test "normalized duplicate email is rejected" do
    create_member(email: "alex@example.test")
    duplicate = User.new(member_attributes(email: " ALEX@EXAMPLE.TEST "))
    assert_not duplicate.valid?
    assert duplicate.errors[:email].present?
  end
end

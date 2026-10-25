require "test_helper"

class ConsultationRequestTest < ActiveSupport::TestCase
  test "a valid query persists under its member with a UUID retry key" do
    member = create_member
    query = create_consultation(user: member)
    assert_equal member, query.reload.user
    assert_equal "Review a sample estate proposal", query.subject
    assert_match(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i, query.request_key)
  end

  test "required query fields category and bounds are enforced" do
    member = create_member
    [
      { subject: "" }, { message: "" }, { category: "Unknown category" },
      { subject: "x" * 141 }, { message: "x" * 5001 },
      { request_key: "" }, { request_key: "not-a-uuid" }
    ].each do |values|
      query = ConsultationRequest.new(consultation_attributes(values).merge(user: member))
      assert_not query.valid?, "invalid query accepted: #{values.keys.join(', ')}"
    end
  end

  test "retry keys are unique per member and independently protected by the database" do
    member = create_member
    query = create_consultation(user: member)
    duplicate = ConsultationRequest.new(consultation_attributes(request_key: query.request_key).merge(user: member))
    assert_not duplicate.valid?
    other = create_consultation(user: create_member, request_key: query.request_key)
    assert other.persisted?
    values = query.attributes.except("id")
    assert_raises(ActiveRecord::RecordNotUnique) { ConsultationRequest.insert_all!([values]) }
  end

  test "a saved retry key cannot be changed" do
    query = create_consultation
    original = query.request_key
    begin
      query.update(request_key: SecureRandom.uuid)
    rescue ActiveRecord::ReadonlyAttributeError
      # A readonly attribute is an acceptable immutable-key implementation.
    end
    assert_equal original, query.reload.request_key
  end
end

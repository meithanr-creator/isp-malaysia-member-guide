require "test_helper"

class AdminEventInterestsTest < ActionDispatch::IntegrationTest
  setup do
    @admin = create_member(role: "admin")
    @event = create_published_event
  end

  test "visitors must log in and members cannot inspect the roster" do
    get admin_event_interests_path(@event)
    assert_redirected_to login_path
    sign_in(create_member)
    get admin_event_interests_path(@event)
    assert_response :forbidden
  end

  test "administrator reads submitted contact snapshots without unrelated profile data or writes" do
    member = create_member(phone: "0189876543", branch: "Private branch detail")
    interest = EventInterest.create!(event: @event, user: member, name: "Submitted Contact", email: "submitted-contact@example.test", company: "Submitted Estate")
    member.update!(name: "Later Profile Name", company: "Later Profile Company")
    before = interest.attributes
    sign_in(@admin)
    assert_no_difference("EventInterest.count") { get admin_event_interests_path(@event) }
    assert_response :success
    assert_equal before, interest.reload.attributes
    assert_includes response.body, "Submitted Contact"
    assert_includes response.body, "submitted-contact@example.test"
    assert_includes response.body, "Submitted Estate"
    assert_not_includes response.body, "Later Profile Name"
    assert_not_includes response.body, "Later Profile Company"
    assert_not_includes response.body, member.phone
    assert_not_includes response.body, member.branch
    assert_select "#event_interest_#{interest.id} time[datetime=?]", interest.created_at.iso8601
    assert_select "#event_interest_#{interest.id} dd", text: "v#{interest.event_revision}"
    assert_includes response.headers.fetch("Cache-Control"), "no-store"
    assert_includes response.headers.fetch("Cache-Control"), "private"
    assert_select ".event-interest-roster form", count: 0
  end

  test "selected event scopes the roster even when a different interest id is supplied" do
    own = EventInterest.create!(event: @event, user: create_member, name: "Selected Event Contact", email: "selected@example.test")
    other = EventInterest.create!(event: create_published_event, user: create_member, name: "Other Event Contact", email: "other-event@example.test")
    sign_in(@admin)
    get admin_event_interests_path(@event), params: { id: other.id, user_id: other.user_id }
    assert_response :success
    assert_select "#event_interest_#{own.id}", count: 1
    assert_select "#event_interest_#{other.id}", count: 0
    assert_not_includes response.body, other.name
    assert_not_includes response.body, other.email
    get admin_event_interests_path(event_id: "unknown-event")
    assert_response :not_found
  end

  test "roster pages contain at most fifty stable ordered entries" do
    interests = 51.times.map do |index|
      EventInterest.create!(event: @event, user: create_member, name: "Contact #{index}", email: "contact-#{index}@example.test", created_at: Time.current - index.minutes)
    end
    sign_in(@admin)
    get admin_event_interests_path(@event)
    assert_response :success
    assert_select ".event-interest-card", count: 50
    assert_select "#event_interest_#{interests.first.id}", count: 1
    assert_select "#event_interest_#{interests.last.id}", count: 0
    assert_select "a[rel=next][href=?]", admin_event_interests_path(@event, page: 2)
    get admin_event_interests_path(@event, page: 2)
    assert_response :success
    assert_select ".event-interest-card", count: 1
    assert_select "#event_interest_#{interests.last.id}", count: 1
    assert_select "a[rel=prev][href=?]", admin_event_interests_path(@event, page: 1)
    assert_select "a[rel=next]", count: 0
  end

  test "empty event is clear and invalid pages do not open unbounded offsets" do
    sign_in(@admin)
    get admin_event_interests_path(@event)
    assert_response :success
    assert_includes response.body, "No member interests have been saved for this event."
    [ "0", "-1", "999999999999999999999999", "2", "1.5", "invalid" ].each do |page|
      get admin_event_interests_path(@event, page: page)
      assert_response :not_found
    end
  end

  test "submitted markup is escaped" do
    name = "<script>alert('contact')</script>"
    company = "<img src=x onerror=alert('company')>"
    interest = EventInterest.create!(event: @event, user: create_member, name: name, email: "escaped@example.test", company: company)
    sign_in(@admin)
    get admin_event_interests_path(@event)
    assert_response :success
    assert_select "#event_interest_#{interest.id} h2", text: name
    assert_select "#event_interest_#{interest.id} script", count: 0
    assert_select "#event_interest_#{interest.id} img", count: 0
  end

  test "pending MFA challenge cannot read contacts before second-factor completion" do
    previous = ENV["ISP_REQUIRE_ADMIN_MFA"]
    ENV["ISP_REQUIRE_ADMIN_MFA"] = "true"
    sign_in(@admin)
    assert_redirected_to two_factor_path
    get admin_event_interests_path(@event)
    assert_redirected_to login_path
    assert_empty @admin.user_sessions
  ensure
    ENV["ISP_REQUIRE_ADMIN_MFA"] = previous
  end

  private

  def sign_in(user)
    post session_path, params: { email: user.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}::1" }
  end
end

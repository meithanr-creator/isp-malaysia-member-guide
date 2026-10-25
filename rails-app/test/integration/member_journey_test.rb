require "test_helper"

class MemberJourneyTest < ActionDispatch::IntegrationTest
  setup do
    @member = create_member
    @event = create_published_event
  end

  test "published event list and detail are public while draft events remain private" do
    draft = create_event(title: "Private editorial draft")
    get events_path
    assert_response :success
    assert_includes response.body, @event.published_title
    assert_not_includes response.body, draft.title
    get event_path(@event)
    assert_response :success
    get event_path(draft)
    assert_response :not_found
  end

  test "review query cannot authenticate a visitor" do
    get events_path(review: "1")
    assert_response :success
    get member_dashboard_path(review: "1")
    assert_redirected_to login_path
    assert_no_difference("EventInterest.count") do
      post event_interest_path(@event), params: { event_interest: { name: "Visitor", email: "visitor@example.test" } }
    end
    assert_redirected_to login_path
  end

  test "member login preserves the selected event interest return" do
    get new_event_interest_path(@event)
    assert_redirected_to login_path
    sign_in
    assert_redirected_to new_event_interest_path(@event)
    follow_redirect!
    assert_response :success
    assert_select "input[name='event_interest[name]'][value=?]", @member.name
    assert_select "input[name='event_interest[email]'][value=?]", @member.email
    assert_select "input[name='event_interest[company]'][value=?]", @member.company
  end

  test "bad password and forged role do not open an administrator session" do
    post session_path, params: { email: @member.email, password: "wrong", role: "admin" }, headers: login_headers
    assert_response :unprocessable_entity
    get member_dashboard_path
    assert_redirected_to login_path
    sign_in(role: "admin")
    get admin_events_path
    assert_response :forbidden
  end

  test "profile edits persist and cannot change role email or another user" do
    other = create_member
    sign_in
    patch member_profile_path, params: { user: { name: "Revised Sample", company: "New Sample Company", branch: "Johor", phone: "0197654321", role: "admin", email: other.email, id: other.id } }
    assert_redirected_to member_dashboard_path
    @member.reload
    assert_equal "Revised Sample", @member.name
    assert_equal "New Sample Company", @member.company
    assert_equal "member", @member.role
    assert_not_equal other.email, @member.email
    assert_equal "Alex Sample", other.reload.name
    get new_event_interest_path(@event)
    assert_select "input[name='event_interest[name]'][value='Revised Sample']"
    assert_select "input[name='event_interest[company]'][value='New Sample Company']"
  end

  test "interest is current-user scoped duplicate-safe and withdrawable" do
    other = create_member
    other_interest = EventInterest.create!(user: other, event: @event, name: other.name, email: other.email)
    sign_in
    parameters = { event_interest: { name: "My Sample Contact", email: "my-contact@example.test", company: "Sample Co", user_id: other.id, event_id: create_event.id, id: other_interest.id } }
    assert_difference("EventInterest.count", 1) { post event_interest_path(@event), params: parameters }
    assert_redirected_to event_path(@event)
    interest = @member.event_interests.find_by!(event: @event)
    assert_equal "My Sample Contact", interest.name
    assert_equal @event.id, interest.event_id
    assert_equal "Alex Sample", other_interest.reload.name
    assert_no_difference("EventInterest.count") { post event_interest_path(@event), params: parameters }
    assert_difference("EventInterest.count", -1) { delete event_interest_path(@event), params: { id: other_interest.id, user_id: other.id } }
    assert EventInterest.exists?(other_interest.id)
    assert_not EventInterest.exists?(interest.id)
  end

  test "invalid interest is rejected without creating a record" do
    sign_in
    assert_no_difference("EventInterest.count") do
      post event_interest_path(@event), params: { event_interest: { name: "", email: "not-an-email", company: "x" * 121 } }
    end
    assert_response :unprocessable_entity
  end

  test "logout closes member access and refuses a later mutation" do
    sign_in
    delete session_path
    assert_redirected_to root_path
    get member_dashboard_path
    assert_redirected_to login_path
    assert_no_difference("EventInterest.count") do
      post event_interest_path(@event), params: { event_interest: { name: @member.name, email: @member.email } }
    end
    assert_redirected_to login_path
  end

  test "cross-site mutation without CSRF token is refused" do
    sign_in
    previous = ApplicationController.allow_forgery_protection
    ApplicationController.allow_forgery_protection = true
    assert_no_difference("EventInterest.count") do
      post event_interest_path(@event), params: { event_interest: { name: @member.name, email: @member.email } }
    end
    assert_response :unprocessable_entity
  ensure
    ApplicationController.allow_forgery_protection = previous
  end

  test "normal login ignores a supplied external return URL" do
    post session_path, params: { email: @member.email, password: "test-password-2026", return_to: "https://outside.example.test/" }, headers: login_headers
    assert_redirected_to member_dashboard_path
  end

  test "demo shortcut is unavailable unless explicitly enabled" do
    previous = ENV["ISP_DEMO_MODE"]
    ENV["ISP_DEMO_MODE"] = "false"
    post demo_session_path, params: { role: "admin" }
    assert_response :not_found
    get admin_events_path
    assert_redirected_to login_path
  ensure
    ENV["ISP_DEMO_MODE"] = previous
  end

  test "repeated failed login is throttled without opening a session" do
    10.times do
      post session_path, params: { email: @member.email, password: "incorrect" }, headers: login_headers
      assert_response :unprocessable_entity
    end
    post session_path, params: { email: @member.email, password: "test-password-2026" }, headers: login_headers
    assert_redirected_to login_path
    follow_redirect!
    assert_includes response.body, "Please wait a moment"
    get member_dashboard_path
    assert_redirected_to login_path
  end

  private

  def sign_in(**extra)
    post session_path, params: { email: @member.email, password: "test-password-2026" }.merge(extra), headers: login_headers
  end

  def login_headers = @login_headers ||= { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
end

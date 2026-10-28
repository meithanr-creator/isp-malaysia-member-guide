require "test_helper"

class AuthenticationLifecycleTest < ActionDispatch::IntegrationTest
  COOKIE_NAME = "_isp_member_demo_session"

  setup { @member = create_member }

  test "logout rejects a previously captured authenticated cookie" do
    sign_in
    captured = cookies[COOKIE_NAME]
    assert_equal 1, @member.user_sessions.count
    delete session_path
    assert_equal 0, @member.user_sessions.count
    assert_replay_denied(captured)
  end

  test "a new login rotates and revokes the previous session token" do
    sign_in
    captured = cookies[COOKIE_NAME]
    previous_id = @member.user_sessions.last.id
    sign_in
    assert_not_equal captured, cookies[COOKIE_NAME]
    assert_not UserSession.exists?(previous_id)
    assert_equal 1, @member.user_sessions.count
    assert_replay_denied(captured)
    get member_dashboard_path
    assert_response :success
  end

  test "account-wide revocation closes all device sessions" do
    sign_in
    captured = cookies[COOKIE_NAME]
    @member.revoke_sessions!
    assert_replay_denied(captured)
    get member_dashboard_path
    assert_redirected_to login_path
  end

  test "changed password closes a captured session" do
    sign_in
    captured = cookies[COOKIE_NAME]
    @member.update!(password: "replacement-password-2026", password_confirmation: "replacement-password-2026")
    assert_replay_denied(captured)
  end

  test "role change requires a fresh login instead of upgrading an existing cookie" do
    sign_in
    captured = cookies[COOKIE_NAME]
    @member.update!(role: "admin")
    browser = open_session
    browser.cookies[COOKIE_NAME] = captured
    browser.get admin_events_path
    assert_equal 302, browser.response.status
    assert_equal login_url, browser.response.location
  end

  test "suspended account closes a captured session and cannot log in" do
    sign_in
    captured = cookies[COOKIE_NAME]
    @member.update!(account_status: "suspended")
    assert_replay_denied(captured)
    sign_in
    assert_response :unprocessable_entity
    assert_empty @member.user_sessions
  end

  test "pending account and unknown account share the credential error" do
    @member.update!(account_status: "pending")
    sign_in
    assert_response :unprocessable_entity
    pending_error = flash[:alert]
    post session_path, params: { email: "unknown@example.test", password: "test-password-2026" }, headers: login_headers
    assert_response :unprocessable_entity
    assert_equal pending_error, flash[:alert]
    assert_empty @member.user_sessions
  end

  test "missing server session rejects an otherwise authentic cookie" do
    sign_in
    captured = cookies[COOKIE_NAME]
    @member.user_sessions.delete_all
    assert_replay_denied(captured)
  end

  test "idle session expiry is enforced on protected requests" do
    sign_in
    travel 31.minutes do
      get member_dashboard_path
      assert_redirected_to login_path
      assert_empty @member.user_sessions
    end
  end

  test "absolute session expiry is enforced even with recent activity" do
    sign_in
    record = @member.user_sessions.last
    captured = cookies[COOKIE_NAME]
    travel_to(record.expires_at, with_usec: true) do
      record.update_columns(last_seen_at: Time.current)
      cookies[COOKIE_NAME] = captured
      get member_dashboard_path
      assert_redirected_to login_path
      assert_empty @member.user_sessions
    end
  end

  test "production rejects sample credentials through the ordinary password endpoint" do
    previous_environment = Rails.env
    Rails.env = "production"
    sign_in
    assert_response :unprocessable_entity
    assert_empty @member.user_sessions
    get member_dashboard_path
    assert_redirected_to login_path
    post demo_session_path, params: { role: "admin" }
    assert_response :not_found
  ensure
    Rails.env = previous_environment
  end

  test "account throttling applies across separate browsers and addresses" do
    10.times do |index|
      browser = open_session
      browser.post session_path, params: { email: @member.email, password: "incorrect" }, headers: { "REMOTE_ADDR" => "192.0.2.#{index}" }
      assert_equal 422, browser.response.status
    end
    sign_in
    assert_redirected_to login_path
    assert_empty @member.user_sessions
  end

  test "production session rechecks linked registry eligibility on every protected request" do
    member = create_member(email: "verified@approved-mail.my", email_verified_at: Time.current)
    entry = MembershipRegistryEntry.create!(name: member.name, email: member.email, member_reference: "PROD-CHECK-001", status: "eligible", user: member)
    previous_environment = Rails.env
    Rails.env = "production"
    post session_path, params: { email: member.email, password: "test-password-2026" }, headers: login_headers
    assert_redirected_to member_dashboard_path
    entry.update!(status: "ineligible")
    get member_dashboard_path
    assert_redirected_to login_path
    assert_empty member.user_sessions
  ensure
    Rails.env = previous_environment
  end
  private

  def assert_replay_denied(captured)
    browser = open_session
    browser.cookies[COOKIE_NAME] = captured
    browser.get member_dashboard_path
    assert_equal 302, browser.response.status
    assert_equal login_url, browser.response.location
  end

  def sign_in
    post session_path, params: { email: @member.email, password: "test-password-2026" }, headers: login_headers
  end

  def login_headers = @login_headers ||= { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}::1" }
end

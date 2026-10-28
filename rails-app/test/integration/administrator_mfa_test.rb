require "test_helper"

class AdministratorMfaTest < ActionDispatch::IntegrationTest
  setup do
    @old_mfa_flag = ENV["ISP_REQUIRE_ADMIN_MFA"]
    ENV["ISP_REQUIRE_ADMIN_MFA"] = "true"
    @admin = create_member(role: "admin")
  end
  teardown { ENV["ISP_REQUIRE_ADMIN_MFA"] = @old_mfa_flag }

  test "password alone opens only a five minute challenge without administrator access" do
    sign_in
    assert_redirected_to two_factor_path
    assert_empty @admin.user_sessions
    get admin_events_path
    assert_redirected_to login_path
    assert_empty @admin.user_sessions
    get two_factor_path
    assert_response :success
    assert_includes response.headers["Cache-Control"], "no-store"
    assert_equal "no-referrer", response.headers["Referrer-Policy"]
    travel 6.minutes do
      get two_factor_path
      assert_redirected_to login_path
    end
  end

  test "enrollment encrypts the secret verifies TOTP and displays recovery codes only once" do
    sign_in
    challenge = @admin.authentication_challenges.last
    secret = challenge.otp_secret
    encrypted = AuthenticationChallenge.connection.select_value("SELECT otp_secret FROM authentication_challenges WHERE id = #{challenge.id}")
    assert_not_equal secret, encrypted
    post two_factor_path, params: { otp_code: ROTP::TOTP.new(secret).now }, headers: login_headers
    assert_redirected_to two_factor_recovery_codes_path
    assert @admin.reload.otp_enabled_at
    assert_equal secret, @admin.otp_secret
    assert @admin.user_sessions.last.mfa_verified_at
    assert challenge.reload.consumed_at
    captured = cookies["_isp_member_demo_session"]
    get two_factor_recovery_codes_path
    assert_response :success
    assert_select "li code", count: 10
    assert_nil challenge.reload.recovery_codes
    browser = open_session
    browser.cookies["_isp_member_demo_session"] = captured
    browser.get two_factor_recovery_codes_path
    assert_equal 302, browser.response.status
    get admin_events_path
    assert_response :success
  end

  test "a TOTP cannot be replayed across separate password challenges" do
    enroll
    code = ROTP::TOTP.new(@admin.reload.otp_secret).now
    delete session_path
    sign_in
    post two_factor_path, params: { otp_code: code }, headers: login_headers
    assert_response :unprocessable_entity
    assert_empty @admin.user_sessions
    travel 31.seconds do
      post two_factor_path, params: { otp_code: ROTP::TOTP.new(@admin.otp_secret).now }, headers: login_headers
      assert_redirected_to admin_events_path
    end
  end

  test "a recovery code is accepted once and removes previous sessions" do
    challenge = enroll
    codes = challenge.take_recovery_codes!
    assert_equal 10, codes.length
    delete session_path
    sign_in
    post two_factor_path, params: { otp_code: codes.first }, headers: login_headers
    assert_redirected_to admin_events_path
    assert_equal 9, @admin.reload.recovery_code_digests.length
    delete session_path
    sign_in
    post two_factor_path, params: { otp_code: codes.first }, headers: login_headers
    assert_response :unprocessable_entity
    assert_empty @admin.user_sessions
  end

  test "changed password or account state invalidates a pending challenge" do
    sign_in
    challenge = @admin.authentication_challenges.last
    @admin.update!(account_status: "suspended")
    post two_factor_path, params: { otp_code: ROTP::TOTP.new(challenge.otp_secret).now }, headers: login_headers
    assert_redirected_to login_path
    assert_empty @admin.user_sessions
  end

  test "five bad MFA attempts throttle the next current code" do
    sign_in
    challenge = @admin.authentication_challenges.last
    5.times do
      post two_factor_path, params: { otp_code: "incorrect" }, headers: login_headers
      assert_response :unprocessable_entity
    end
    post two_factor_path, params: { otp_code: ROTP::TOTP.new(challenge.otp_secret).now }, headers: login_headers
    assert_response :too_many_requests
    assert_empty @admin.user_sessions
  end

  test "password reset retains configured MFA and requires a new challenge" do
    enroll
    secret = @admin.reload.otp_secret
    record, token = AccountToken.issue(@admin, purpose: "recovery")
    record.update!(delivery_status: "sent", delivery_token: nil)
    patch password_recovery_reset_path, params: { token: token, password: "replacement-admin-password", password_confirmation: "replacement-admin-password" }
    assert_redirected_to login_path
    assert_empty @admin.user_sessions
    assert_equal secret, @admin.reload.otp_secret
    post session_path, params: { email: @admin.email, password: "replacement-admin-password" }, headers: login_headers
    assert_redirected_to two_factor_path
    assert_empty @admin.user_sessions
  end

  test "direct session issuance requires a completed MFA proof" do
    @admin.update!(otp_secret: ROTP::Base32.random_base32, otp_enabled_at: Time.current)
    assert_nil UserSession.issue(@admin, authenticated_password_digest: @admin.password_digest)
    assert UserSession.issue(@admin, authenticated_password_digest: @admin.password_digest, mfa_verified: true)
  end

  test "logout revokes a pending challenge even when its cookie was copied" do
    sign_in
    captured = cookies["_isp_member_demo_session"]
    challenge = @admin.authentication_challenges.last
    delete session_path
    assert challenge.reload.consumed_at
    assert_nil challenge.otp_secret
    browser = open_session
    browser.cookies["_isp_member_demo_session"] = captured
    browser.get two_factor_path
    assert_equal 302, browser.response.status
    assert_equal login_url, browser.response.location
    assert_empty @admin.user_sessions
  end

  test "switching accounts invalidates the previous pending challenge cookie" do
    sign_in
    captured = cookies["_isp_member_demo_session"]
    challenge = @admin.authentication_challenges.last
    member = create_member
    post session_path, params: { email: member.email, password: "test-password-2026" }, headers: login_headers
    assert_redirected_to member_dashboard_path
    assert challenge.reload.consumed_at
    browser = open_session
    browser.cookies["_isp_member_demo_session"] = captured
    browser.get two_factor_path
    assert_equal 302, browser.response.status
    assert_equal login_url, browser.response.location
  end
  private

  def enroll
    sign_in
    challenge = @admin.authentication_challenges.last
    post two_factor_path, params: { otp_code: ROTP::TOTP.new(challenge.otp_secret).now }, headers: login_headers
    assert_redirected_to two_factor_recovery_codes_path
    challenge.reload
  end

  def sign_in
    post session_path, params: { email: @admin.email, password: "test-password-2026" }, headers: login_headers
  end

  def login_headers = @login_headers ||= { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}::1" }
end

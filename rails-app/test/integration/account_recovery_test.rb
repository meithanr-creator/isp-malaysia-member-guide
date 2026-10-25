require "test_helper"
require "stringio"

class AccountRecoveryTest < ActionDispatch::IntegrationTest
  setup { @member = create_member }

  test "known unknown suspended and rate limited recovery requests share the response" do
    post password_recovery_path, params: { email: @member.email }
    assert_redirected_to password_recovery_path
    message = flash[:notice]
    6.times do |index|
      post password_recovery_path, params: { email: index.even? ? @member.email : "unknown@example.test" }
      assert_redirected_to password_recovery_path
      assert_equal message, flash[:notice]
    end
  end

  test "activation and reset pages exclude secrets from URLs and are private" do
    [activation_path, password_recovery_reset_path].each do |path|
      get path
      assert_response :success
      assert_equal "no-referrer", response.headers["Referrer-Policy"]
      assert_includes response.headers["Cache-Control"], "no-store"
      assert_select "input[name=token]", count: 1
      assert_select "form[data-controller=account-token]", count: 1
      assert_select "noscript", text: /JavaScript is required/
    end
  end

  test "invalid tokens have a generic response without changing an account" do
    assert_no_difference("UserSession.count") do
      patch activation_path, params: { token: "invalid", password: "new-private-password", password_confirmation: "new-private-password" }
    end
    assert_response :unprocessable_entity
    assert_includes response.body, "This link has expired or is unavailable"
    assert @member.reload.authenticate("test-password-2026")
  end

  test "reset logs filter both raw token and password" do
    record, token = AccountToken.issue(@member, purpose: "recovery")
    record.update!(delivery_status: "sent", delivery_token: nil)
    output = StringIO.new
    previous_logger = ActionController::Base.logger
    ActionController::Base.logger = ActiveSupport::Logger.new(output)
    patch password_recovery_reset_path, params: { token: token, password: "new-private-password", password_confirmation: "new-private-password" }
    assert_redirected_to login_path
    assert_not_includes output.string, token
    assert_not_includes output.string, "new-private-password"
    assert_includes output.string, "[FILTERED]"
  ensure
    ActionController::Base.logger = previous_logger
  end

  test "oversized credentials are rejected server side" do
    assert_nil User.authenticate_credentials(@member.email, "p" * 100_000)
    assert_nil User.authenticate_credentials("e" * 100_000, "test-password-2026")
    post session_path, params: { email: @member.email, password: "p" * 1000 }, headers: { "REMOTE_ADDR" => "192.0.2.42" }
    assert_response :unprocessable_entity
    assert_empty @member.user_sessions
  end
end

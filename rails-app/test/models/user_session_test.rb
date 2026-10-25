require "test_helper"

class UserSessionTest < ActiveSupport::TestCase
  setup { @user = create_member }

  test "only a digest of the random authentication token is stored" do
    record, token = issue
    assert_match(/\A[0-9a-f]{64}\z/, token)
    assert_equal Digest::SHA256.hexdigest(token), record.token_digest
    assert_not_equal token, record.token_digest
    assert_equal @user, UserSession.resume(token).user
    assert_in_delta 12.hours, record.expires_at - record.created_at, 1
  end

  test "malformed unknown and missing tokens fail closed" do
    [nil, "", "old-user-id", "a" * 63, "f" * 64].each do |token|
      assert_nil UserSession.resume(token)
    end
  end

  test "idle timeout expires at the boundary" do
    record, token = issue
    travel_to(record.last_seen_at + UserSession::IDLE_TIMEOUT, with_usec: true) do
      assert_nil UserSession.resume(token)
      assert_not UserSession.exists?(record.id)
    end
  end

  test "activity extends idle time without extending absolute expiry" do
    record, token = issue
    original_expiry = record.expires_at
    travel 20.minutes do
      assert UserSession.resume(token)
      assert_in_delta Time.current.to_f, record.reload.last_seen_at.to_f, 1
      assert_equal original_expiry, record.expires_at
    end
  end

  test "absolute timeout expires an otherwise active session" do
    record, token = issue
    travel_to(record.expires_at, with_usec: true) do
      record.update_columns(last_seen_at: Time.current)
      assert_nil UserSession.resume(token)
      assert_not UserSession.exists?(record.id)
    end
  end

  test "revoking all sessions denies tokens from every device" do
    first = issue.last
    second = issue.last
    assert_equal 2, @user.user_sessions.count
    @user.revoke_sessions!
    assert_nil UserSession.resume(first)
    assert_nil UserSession.resume(second)
  end

  test "security changes bypassing callbacks still invalidate the token" do
    record, token = issue
    @user.update_columns(role: "admin")
    assert_nil UserSession.resume(token)
    assert_not UserSession.exists?(record.id)
  end

  test "a stale password verification cannot issue a new session" do
    old_digest = @user.password_digest
    @user.update!(password: "changed-password-2026", password_confirmation: "changed-password-2026")
    assert_nil UserSession.issue(@user, authenticated_password_digest: old_digest)
    assert_empty @user.user_sessions
  end

  test "pending and suspended accounts cannot receive sessions" do
    %w[pending suspended].each do |status|
      @user.update!(account_status: status)
      assert_nil UserSession.issue(@user, authenticated_password_digest: @user.password_digest)
    end
  end

  test "expired server records are cleaned in bounded batches" do
    expired, = issue
    travel 31.minutes do
      live, token = issue
      assert_not UserSession.exists?(expired.id)
      assert UserSession.resume(token)
      assert UserSession.exists?(live.id)
    end
  end

  private

  def issue = UserSession.issue(@user, authenticated_password_digest: @user.password_digest)
end

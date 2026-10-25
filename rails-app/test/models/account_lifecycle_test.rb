require "test_helper"

class AccountLifecycleTest < ActiveSupport::TestCase
  setup do
    @old_email_flag = ENV["ISP_ACCOUNT_EMAILS_ENABLED"]
    @old_dispatch_flag = ENV["ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED"]
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] = "true"
    ENV["ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED"] = "true"
    ActionMailer::Base.deliveries.clear
    @actor = create_member(role: "admin")
    @entry = MembershipRegistryEntry.create!(name: "Invited Sample", email: "invited@example.test", member_reference: "LOCAL-001", status: "eligible")
  end

  teardown do
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] = @old_email_flag
    ENV["ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED"] = @old_dispatch_flag
  end

  test "invitation creates a linked pending member and email token is hashed and encrypted" do
    assert AccountInvitation.call(entry: @entry, actor: @actor).success?
    user = @entry.reload.user
    assert_equal "pending", user.account_status
    assert_nil user.email_verified_at
    assert_not user.login_allowed?
    token = email_token
    record = user.account_tokens.last
    assert_equal Digest::SHA256.hexdigest(token), record.token_digest
    assert_nil record.delivery_token
    assert_equal "sent", record.delivery_status
    assert_equal 1, ActionMailer::Base.deliveries.size
    assert_includes ActionMailer::Base.deliveries.last.body.decoded, "/activation#token="
  end

  test "activation rechecks eligibility verifies email and consumes token once" do
    AccountInvitation.call(entry: @entry, actor: @actor)
    token = email_token
    result = consume(token, "activation")
    assert result.success?, result.error
    assert_equal "active", result.user.account_status
    assert result.user.email_verified_at
    assert result.user.authenticate("new-private-password-2026")
    assert_not consume(token, "activation").success?
    assert_empty result.user.user_sessions
  end

  test "invalid password preserves token for a corrected retry" do
    AccountInvitation.call(entry: @entry, actor: @actor)
    token = email_token
    result = AccountTokenConsumer.call(token: token, purpose: "activation", password: "short", password_confirmation: "short")
    assert_not result.success?
    assert AccountToken.lookup(token, purpose: "activation").usable?
    assert consume(token, "activation").success?
  end

  test "ineligible row cannot activate an outstanding invitation" do
    AccountInvitation.call(entry: @entry, actor: @actor)
    token = email_token
    @entry.update!(status: "ineligible")
    assert_not consume(token, "activation").success?
    assert_equal "pending", @entry.user.reload.account_status
  end

  test "activation expires and resend invalidates previous link" do
    AccountInvitation.call(entry: @entry, actor: @actor)
    previous = email_token
    AccountInvitation.call(entry: @entry.reload, actor: @actor)
    current = email_token
    assert_not_equal previous, current
    assert_not consume(previous, "activation").success?
    record = AccountToken.lookup(current, purpose: "activation")
    travel_to(record.expires_at, with_usec: true) { assert_not consume(current, "activation").success? }
  end

  test "disabled invitation does not create any account or send mail" do
    ENV["ISP_ACCOUNT_EMAILS_ENABLED"] = "false"
    assert_no_difference(["User.count", "AccountToken.count"]) do
      assert_not AccountInvitation.call(entry: @entry, actor: @actor).success?
    end
    assert_nil @entry.reload.user
    assert_empty ActionMailer::Base.deliveries
  end

  test "failed invitation is not reported sent and its token is revoked" do
    result = AccountInvitation.call(entry: @entry, actor: @actor, deliver: ->(_record) { raise IOError, "email unavailable" })
    assert_not result.success?
    record = @entry.reload.user.account_tokens.last
    assert_equal "failed", record.delivery_status
    assert record.consumed_at
    assert_nil record.delivery_token
    assert_not record.usable?
    assert_equal "pending", @entry.user.account_status
  end

  test "existing unlinked user collision never becomes an invitation" do
    create_member(email: @entry.email)
    assert_no_difference("User.count") { assert_not AccountInvitation.call(entry: @entry, actor: @actor).success? }
    assert_nil @entry.reload.user
    assert_empty ActionMailer::Base.deliveries
  end

  test "recovery request queues encrypted token and performs no SMTP delivery" do
    user = create_member
    PasswordRecoveryRequest.call(email: user.email)
    record = user.account_tokens.last
    assert_equal "queued", record.delivery_status
    assert record.delivery_token
    encrypted = AccountToken.connection.select_value("SELECT delivery_token FROM account_tokens WHERE id = #{record.id}")
    assert_not_equal record.delivery_token, encrypted
    assert_not record.usable?
    assert_empty ActionMailer::Base.deliveries
    assert_equal 1, AccountEmailDispatcher.call.sent
    assert_equal "sent", record.reload.delivery_status
    assert_nil record.delivery_token
    assert_equal 1, ActionMailer::Base.deliveries.size
  end

  test "recovery dispatch never resends a completed or failed record" do
    user = create_member
    PasswordRecoveryRequest.call(email: user.email)
    calls = 0
    deliver = ->(_record) { calls += 1; raise IOError, "email unavailable" }
    result = AccountEmailDispatcher.call(deliver: deliver)
    assert_equal 1, result.failed
    assert_equal 0, AccountEmailDispatcher.call(deliver: deliver).sent
    assert_equal 1, calls
    record = user.account_tokens.last
    assert_equal "failed", record.delivery_status
    assert record.consumed_at
    assert_nil record.delivery_token
    assert_not record.usable?
  end

  test "abandoned delivery lease is revoked rather than resent" do
    user = create_member
    PasswordRecoveryRequest.call(email: user.email)
    record = user.account_tokens.last
    record.update!(delivery_status: "dispatching", delivery_lease_at: 6.minutes.ago)
    called = false
    AccountEmailDispatcher.call(deliver: ->(_record) { called = true })
    assert_not called
    assert_equal "failed", record.reload.delivery_status
    assert record.consumed_at
    assert_nil record.delivery_token
  end

  test "dispatcher remains disabled until explicitly enabled" do
    user = create_member
    PasswordRecoveryRequest.call(email: user.email)
    ENV["ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED"] = "false"
    assert_not AccountEmailDispatcher.call.enabled?
    assert_equal "queued", user.account_tokens.last.delivery_status
    assert_empty ActionMailer::Base.deliveries
  end

  test "unknown suspended and oversized recovery requests do not enqueue mail" do
    suspended = create_member(account_status: "suspended")
    assert_no_difference("AccountToken.count") do
      PasswordRecoveryRequest.call(email: "unknown@example.test")
      PasswordRecoveryRequest.call(email: suspended.email)
      PasswordRecoveryRequest.call(email: "a" * 200)
    end
    assert_empty ActionMailer::Base.deliveries
  end

  test "password reset consumes link and revokes all existing sessions" do
    user = create_member
    UserSession.issue(user, authenticated_password_digest: user.password_digest)
    PasswordRecoveryRequest.call(email: user.email)
    AccountEmailDispatcher.call
    token = email_token
    assert consume(token, "recovery").success?
    assert_empty user.user_sessions.reload
    assert_not consume(token, "recovery").success?
    assert user.reload.authenticate("new-private-password-2026")
  end

  test "recovery expiry purpose mismatch and changed credentials fail closed" do
    user = create_member
    record, token = AccountToken.issue(user, purpose: "recovery")
    record.update!(delivery_status: "sent", delivery_token: nil)
    assert_not consume(token, "activation").success?
    travel_to(record.expires_at, with_usec: true) { assert_not consume(token, "recovery").success? }
    user.update!(password: "changed-original-password", password_confirmation: "changed-original-password")
    assert_not consume(token, "recovery").success?
  end

  test "mailer instrumentation redacts link token and recipient metadata" do
    payloads = []
    subscription = ActiveSupport::Notifications.subscribe("deliver.action_mailer") { |event| payloads << event.payload.dup }
    AccountInvitation.call(entry: @entry, actor: @actor)
    token = email_token
    assert_equal 1, payloads.length
    assert_equal "[Account email content redacted]", payloads.first[:mail]
    assert_not_includes payloads.first.to_json, token
    assert_not_includes payloads.first.to_json, @entry.email
  ensure
    ActiveSupport::Notifications.unsubscribe(subscription) if subscription
  end

  test "a losing dispatcher preserves the lease claimed by a different worker" do
    user = create_member
    PasswordRecoveryRequest.call(email: user.email)
    first = user.account_tokens.last
    stale = AccountToken.find(first.id)
    lease = AccountEmailDispatcher.claim(first)
    assert lease
    assert_nil AccountEmailDispatcher.claim(stale)
    assert_equal "dispatching", first.reload.delivery_status
    assert_nil first.consumed_at
    assert AccountEmailDispatcher.complete(first, lease)
    assert_equal "sent", first.reload.delivery_status
  end

  test "delivery completion cannot succeed after lease invalidation" do
    user = create_member
    PasswordRecoveryRequest.call(email: user.email)
    record = user.account_tokens.last
    lease = AccountEmailDispatcher.claim(record)
    record.update!(delivery_status: "failed", consumed_at: Time.current, delivery_token: nil)
    assert_not AccountEmailDispatcher.complete(record, lease)
    assert_equal "failed", record.reload.delivery_status
  end
  test "already scrubbed rows cannot starve later expired delivery secrets" do
    user = create_member
    stale = nil
    55.times do
      stale, = AccountToken.issue(user, purpose: "recovery")
      stale.update!(delivery_token: nil, consumed_at: Time.current)
    end
    target, = AccountToken.issue(user, purpose: "recovery")
    target.update!(expires_at: 1.minute.ago)
    assert target.delivery_token
    AccountEmailDispatcher.cleanup!
    assert_nil target.reload.delivery_token
  end
  private

  def email_token
    ActionMailer::Base.deliveries.last.body.decoded.match(/#token=([0-9a-f]{64})/)[1]
  end

  def consume(token, purpose)
    AccountTokenConsumer.call(token: token, purpose: purpose, password: "new-private-password-2026", password_confirmation: "new-private-password-2026")
  end
end

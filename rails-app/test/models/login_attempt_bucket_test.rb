require "test_helper"

class LoginAttemptBucketTest < ActiveSupport::TestCase
  test "account throttling cannot be bypassed with a different IP" do
    now = Time.utc(2026, 10, 25, 12, 0, 10)
    10.times { |index| assert LoginAttemptBucket.allowed?(email: " member@example.test ", ip: "192.0.2.#{index}", now: now) }
    assert_not LoginAttemptBucket.allowed?(email: "MEMBER@EXAMPLE.TEST", ip: "192.0.2.200", now: now)
  end

  test "IP throttling cannot be bypassed with a different account" do
    now = Time.utc(2026, 10, 25, 12, 0, 10)
    30.times { |index| assert LoginAttemptBucket.allowed?(email: "member-#{index}@example.test", ip: "192.0.2.1", now: now) }
    assert_not LoginAttemptBucket.allowed?(email: "another@example.test", ip: "192.0.2.1", now: now)
  end

  test "counter values persist across model reload and reset after the window" do
    now = Time.utc(2026, 10, 25, 12, 0, 10)
    10.times { LoginAttemptBucket.allowed?(email: "member@example.test", ip: "192.0.2.1", now: now) }
    assert_equal [10, 10], LoginAttemptBucket.order(:id).pluck(:attempts)
    LoginAttemptBucket.reset_column_information
    assert_not LoginAttemptBucket.allowed?(email: "member@example.test", ip: "192.0.2.1", now: now)
    assert LoginAttemptBucket.allowed?(email: "member@example.test", ip: "192.0.2.1", now: now + 3.minutes)
    assert_equal 2, LoginAttemptBucket.count
  end

  test "buckets contain keyed digests instead of raw account or address" do
    LoginAttemptBucket.allowed?(email: "private@example.test", ip: "192.0.2.1")
    LoginAttemptBucket.find_each do |bucket|
      assert_match(/\A[0-9a-f]{64}\z/, bucket.scope_digest)
      assert_not_includes bucket.attributes.to_json, "private@example.test"
      assert_not_includes bucket.attributes.to_json, "192.0.2.1"
    end
  end
end

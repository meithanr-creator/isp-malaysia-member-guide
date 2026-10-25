require "test_helper"
require "timeout"

# Separate committed records/connections are needed to exercise PostgreSQL row locks.
class EventInterestConcurrencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  test "simultaneous registrations return success and retain exactly one snapshot" do
    skip "PostgreSQL row-lock exercise runs in the PostgreSQL CI job" unless ActiveRecord::Base.connection.adapter_name == "PostgreSQL"
    member = create_member
    throttle_scopes = [["login:account", member.email], ["login:ip", "2001:db8:44::1"], ["login:ip", "2001:db8:44::2"]].map { |scope, value| LoginAttemptBucket.send(:scope_digest, scope, value) }
    event = create_published_event
    ready = Queue.new
    release = Queue.new
    results = Queue.new
    errors = Queue.new
    workers = 2.times.map do |index|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          client = ActionDispatch::Integration::Session.new(Rails.application)
          client.post session_path, params: { email: member.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:44::#{index + 1}" }
          raise "Login failed" unless client.response.redirect?
          ready << true
          release.pop
          client.post event_interest_path(event), params: { event_interest: { name: member.name, email: member.email, company: member.company } }
          results << [client.response.status, client.response.location]
        end
      rescue StandardError => error
        errors << error
        ready << false
      end
    end
    Timeout.timeout(20) { 2.times { assert ready.pop, "Concurrent login failed" } }
    2.times { release << true }
    Timeout.timeout(20) { workers.each(&:join) }
    raise errors.pop unless errors.empty?
    2.times do
      status, location = results.pop
      assert_equal 302, status
      assert_equal event_path(event), URI.parse(location).path
    end
    interests = EventInterest.where(user_id: member.id, event_id: event.id)
    assert_equal 1, interests.count
    assert_equal event.published_revision, interests.first.event_revision
    assert_equal event.published_data, interests.first.event_snapshot
  ensure
    workers&.each { |worker| worker.kill if worker.alive? }
    workers&.each(&:join)
    LoginAttemptBucket.where(scope_digest: throttle_scopes).delete_all if throttle_scopes
    if member
      EventInterest.where(user_id: member.id).delete_all
      UserSession.where(user_id: member.id).delete_all if defined?(UserSession)
      member.destroy!
    end
    event&.destroy!
  end
end

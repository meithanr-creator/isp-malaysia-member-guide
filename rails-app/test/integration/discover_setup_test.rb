require "test_helper"
require "timeout"

class DiscoverSetupTest < ActionDispatch::IntegrationTest
  setup do
    DiscoverSlide.delete_all
    @admin = create_member(role: "admin")
  end

  teardown { close_discover_uploads }

  test "visitor and member cannot initialize Discover cards" do
    assert_no_difference("DiscoverSlide.count") { post admin_discover_setup_path }
    assert_redirected_to login_path
    sign_in(create_member)
    assert_no_difference("DiscoverSlide.count") { post admin_discover_setup_path }
    assert_response :forbidden
  end

  test "fresh database setup creates only the three shipped cards" do
    sign_in
    get admin_discover_path
    assert_response :success
    assert_select "form[action=?]", admin_discover_setup_path, count: 1
    original_counts = [User.count, Event.count, Publication.count, MembershipRegistryEntry.count]
    assert_difference("DiscoverSlide.count", 3) { post admin_discover_setup_path }
    assert_redirected_to admin_discover_path
    assert_equal original_counts, [User.count, Event.count, Publication.count, MembershipRegistryEntry.count]
    audit = AdministrativeAudit.find_by!(action: "discover_setup", actor_id: @admin.id)
    assert_equal @admin.id, audit.actor_id
    assert_equal "DiscoverConfiguration", audit.target_type
    assert_equal 1, audit.revision
    DiscoverSlide::DEFAULTS.each do |attributes|
      card = DiscoverSlide.find_by!(position: attributes.fetch(:position))
      attributes.each { |key, value| assert_equal value, card.public_send(key) }
      refute card.image.attached?
    end
    follow_redirect!
    assert_select "form[action=?]", admin_discover_setup_path, count: 0
    assert_includes response.body, "Review each card"
  end

  test "repeated setup preserves all existing saved content and edit versions" do
    sign_in
    post admin_discover_setup_path
    saved = DiscoverSlide.find_by!(position: 2)
    saved.update!(title: "Fictional reviewed member knowledge", website_url: "https://example.test/reviewed")
    before = DiscoverSlide.order(:position).map(&:attributes)
    assert_no_difference("DiscoverSlide.count") { post admin_discover_setup_path, params: { title: "Untrusted replacement", position: 4, website_url: "https://untrusted.example.test/" } }
    assert_equal before, DiscoverSlide.order(:position).map(&:attributes)
  end

  test "partial setup adds missing slots while preserving the existing card" do
    existing = create_discover_slide(position: 2, title: "Fictional preserved card")
    before = existing.attributes
    sign_in
    get admin_discover_path
    assert_select "form[action=?]", admin_discover_setup_path, count: 1
    assert_difference("DiscoverSlide.count", 2) { post admin_discover_setup_path }
    assert_equal before, existing.reload.attributes
    assert_equal [1, 2, 3], DiscoverSlide.ordered.pluck(:position)
  end

  test "tokenless setup cannot create cards when CSRF protection is enabled" do
    sign_in
    previous = ApplicationController.allow_forgery_protection
    ApplicationController.allow_forgery_protection = true
    assert_no_difference("DiscoverSlide.count") { post admin_discover_setup_path }
    assert_response :unprocessable_entity
  ensure
    ApplicationController.allow_forgery_protection = previous
  end

  test "Discover edit records the actor and saved revision in the same transaction" do
    card = create_discover_slide
    sign_in
    assert_difference("AdministrativeAudit.count", 1) do
      patch admin_discover_slide_path(card), params: { discover_slide: { title: "Fictional audited edit", lock_version: card.lock_version } }
    end
    assert_response :redirect
    audit = AdministrativeAudit.find_by!(action: "discover_update")
    assert_equal @admin.id, audit.actor_id
    assert_equal "DiscoverSlide", audit.target_type
    assert_equal card.id, audit.target_id
    assert_equal card.reload.lock_version, audit.revision
  end

  test "audit failure rolls back Discover setup and an existing card edit" do
    sign_in
    original_audit = AdministrativeAudit.method(:create!)
    begin
      AdministrativeAudit.define_singleton_method(:create!) { |*| raise ActiveRecord::RecordInvalid.new(AdministrativeAudit.new) }
      assert_no_difference(["DiscoverSlide.count", "AdministrativeAudit.count"]) { post admin_discover_setup_path }
      assert_response :unprocessable_entity
      card = create_discover_slide
      before = card.attributes
      patch admin_discover_slide_path(card), params: { discover_slide: { title: "Not recorded", lock_version: card.lock_version } }
      assert_response :unprocessable_entity
      assert_equal before, card.reload.attributes
      assert_select "input[name='discover_slide[title]'][value=?]", "Not recorded"
      assert_select "input[type=file][value]", count: 0
    ensure
      AdministrativeAudit.define_singleton_method(:create!, original_audit)
    end
  end

  test "stale MFA denies setup and edit before any upload scan or draft change" do
    old_flag = ENV["ISP_REQUIRE_ADMIN_MFA"]
    ENV["ISP_REQUIRE_ADMIN_MFA"] = "true"
    secret = ROTP::Base32.random_base32
    @admin.update!(otp_secret: secret, otp_enabled_at: Time.current)
    card = create_discover_slide
    before = card.attributes
    sign_in
    assert_redirected_to two_factor_path
    post two_factor_path, params: { otp_code: ROTP::TOTP.new(secret).now }, headers: { "REMOTE_ADDR" => "2001:db8:82::99" }
    assert_redirected_to admin_events_path
    scans = 0
    original_scan = UploadScanner.method(:error)
    begin
      UploadScanner.define_singleton_method(:error) { |_file| scans += 1; nil }
      travel 11.minutes do
        assert_no_difference(["DiscoverSlide.count", "AdministrativeAudit.count"]) { post admin_discover_setup_path }
        assert_response :unprocessable_entity
        assert_select "a[href=?][target=_blank]", admin_verification_path, count: 1
        assert_no_difference(["ActiveStorage::Blob.count", "AdministrativeAudit.count"]) do
          patch admin_discover_slide_path(card), params: { discover_slide: { title: "Stale MFA change", image: discover_upload, lock_version: card.lock_version } }
        end
        assert_response :unprocessable_entity
        assert_equal before, card.reload.attributes
        assert_select "input[name='discover_slide[title]'][value=?]", "Stale MFA change"
        assert_select "input[type=file][value]", count: 0
      end
    ensure
      UploadScanner.define_singleton_method(:error, original_scan)
    end
    assert_equal 0, scans
  ensure
    ENV["ISP_REQUIRE_ADMIN_MFA"] = old_flag
  end
  private

  def sign_in(user = @admin)
    post session_path, params: { email: user.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
  end
end

# Committed records and independent connections exercise the unique-position
# conflict path in the PostgreSQL CI job; SQLite cannot establish this behavior.
class DiscoverSetupConcurrencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  test "simultaneous setup requests add exactly the three fixed slots" do
    skip "PostgreSQL conflict exercise runs in the PostgreSQL CI job" unless ActiveRecord::Base.connection.adapter_name == "PostgreSQL"
    assert_equal 0, DiscoverSlide.count, "Concurrent setup requires an empty isolated test list"
    cleanup_cards = true
    admin = create_member(role: "admin")
    throttle_scopes = [["login:account", admin.email], ["login:ip", "2001:db8:82::1"], ["login:ip", "2001:db8:82::2"]].map { |scope, value| LoginAttemptBucket.send(:scope_digest, scope, value) }
    ready, release, results, errors = Queue.new, Queue.new, Queue.new, Queue.new
    workers = 2.times.map do |index|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          client = ActionDispatch::Integration::Session.new(Rails.application)
          client.post session_path, params: { email: admin.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:82::#{index + 1}" }
          raise "Concurrent administrator login failed" unless client.response.redirect?
          ready << true
          release.pop
          client.post admin_discover_setup_path
          results << [client.response.status, client.response.location]
        end
      rescue StandardError => error
        errors << error
        ready << false
      end
    end
    Timeout.timeout(20) { 2.times { assert ready.pop, "Concurrent administrator login failed" } }
    2.times { release << true }
    Timeout.timeout(20) { workers.each(&:join) }
    raise errors.pop unless errors.empty?
    2.times do
      status, location = results.pop
      assert_equal 302, status
      assert_equal admin_discover_path, URI.parse(location).path
    end
    assert_equal [1, 2, 3], DiscoverSlide.ordered.pluck(:position)
    DiscoverSlide::DEFAULTS.each do |attributes|
      card = DiscoverSlide.find_by!(position: attributes.fetch(:position))
      attributes.each { |key, value| assert_equal value, card.public_send(key) }
    end
  ensure
    workers&.each { |worker| worker.kill if worker.alive? }
    workers&.each(&:join)
    LoginAttemptBucket.where(scope_digest: throttle_scopes).delete_all if throttle_scopes
    DiscoverSlide.where(position: 1..3).destroy_all if cleanup_cards
    # These committed audit rows belong only to this nontransactional test actor.
    AdministrativeAudit.where(actor_id: admin.id).delete_all if admin
    admin&.destroy!
  end
end




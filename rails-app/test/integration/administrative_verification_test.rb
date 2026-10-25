require "test_helper"

class AdministrativeVerificationTest < ActionDispatch::IntegrationTest
  setup do
    @previous_mfa = ENV["ISP_REQUIRE_ADMIN_MFA"]
    ENV["ISP_REQUIRE_ADMIN_MFA"] = "true"
    @admin = create_member(role: "admin", otp_secret: ROTP::Base32.random_base32,
      otp_enabled_at: Time.current, otp_last_used_at: 1.minute.ago)
    @event = create_event
    sign_in_with_mfa
  end
  teardown do
    ENV["ISP_REQUIRE_ADMIN_MFA"] = @previous_mfa
    close_discover_uploads
  end

  test "stale editor GET redirects to dedicated verification without closing sign in" do
    travel 11.minutes do
      get edit_admin_event_path(@event)
      assert_redirected_to admin_verification_path(return_to: edit_admin_event_path(@event))
      get admin_verification_path
      assert_response :success
      assert_select "input[name=password]"
      assert_select "input[name=otp_code]"
      get admin_events_path
      assert_response :success
    end
  end

  test "stale event draft and upload POST preserve text without database mutation" do
    original = @event.attributes
    upload = discover_upload(content: "%PDF-1.7 unpublished", filename: "brochure.pdf", type: "application/pdf")
    travel 11.minutes do
      assert_no_difference(["ActiveStorage::Blob.count", "AdministrativeAudit.count"]) do
        patch admin_event_path(@event), params: { event: { title: "Unsaved title retained", bank_name: "Unsaved approved bank", receipt_email: "unsaved@example.test", lock_version: @event.lock_version, brochure: upload } }
      end
      assert_response :unprocessable_entity
      assert_equal original, @event.reload.attributes
      assert_select "input[name='event[title]'][value='Unsaved title retained']"
      assert_select "a[target='_blank'][href=?]", admin_verification_path
      assert_includes response.body, "Nothing was saved"
    end
  end

  test "stale event create does not persist an empty draft" do
    travel 11.minutes do
      assert_no_difference(["Event.count", "AdministrativeAudit.count"]) { post admin_events_path, params: { event: valid_event_data(title: "Unsaved new event") } }
      assert_response :unprocessable_entity
      assert_select "input[name='event[title]'][value='Unsaved new event']"
    end
  end

  test "stale publication upload preserves fields without storing files" do
    publication = create_publication
    original = publication.attributes
    travel 11.minutes do
      assert_no_difference(["ActiveStorage::Blob.count", "AdministrativeAudit.count"]) do
        patch admin_publication_path(publication), params: { publication: { title: "Unsaved publication", lock_version: publication.lock_version, pdf: discover_upload(content: "%PDF-1.7 no store", filename: "book.pdf", type: "application/pdf") } }
      end
      assert_response :unprocessable_entity
      assert_equal original, publication.reload.attributes
      assert_select "input[name='publication[title]'][value='Unsaved publication']"
      assert_select "a[target='_blank'][href=?]", admin_verification_path
    end
  end

  test "stepup rotates server token keeps original CSRF valid and denies old cookie replay" do
    previous_forgery = ApplicationController.allow_forgery_protection
    ApplicationController.allow_forgery_protection = true
    get edit_admin_event_path(@event)
    assert_response :success
    csrf = css_select("meta[name=csrf-token]").first["content"]
    captured = cookies["_isp_member_demo_session"]
    old_id = @admin.user_sessions.last.id
    travel 11.minutes do
      post admin_verification_path, params: { authenticity_token: csrf, password: "test-password-2026", otp_code: ROTP::TOTP.new(@admin.reload.otp_secret).now }, headers: login_headers
      assert_redirected_to admin_events_path
      assert_not UserSession.exists?(old_id)
      assert_not_equal captured, cookies["_isp_member_demo_session"]
      patch admin_event_path(@event), params: { authenticity_token: csrf, event: { title: "Saved after verification", lock_version: @event.lock_version } }
      assert_redirected_to admin_events_path
      assert_equal "Saved after verification", @event.reload.title
      browser = open_session
      browser.cookies["_isp_member_demo_session"] = captured
      browser.get admin_events_path
      assert_equal 302, browser.response.status
      assert_equal login_url, browser.response.location
    end
  ensure
    ApplicationController.allow_forgery_protection = previous_forgery
  end

  test "incorrect stepup password cannot refresh administrator authority" do
    original = @admin.user_sessions.last.mfa_verified_at
    travel 11.minutes do
      post admin_verification_path, params: { password: "incorrect", otp_code: ROTP::TOTP.new(@admin.reload.otp_secret).now }, headers: login_headers
      assert_response :unprocessable_entity
      assert_equal original, @admin.user_sessions.last.mfa_verified_at
      assert_no_changes -> { @event.reload.attributes } do
        patch admin_event_path(@event), params: { event: { bank_name: "Blocked change", lock_version: @event.lock_version } }
        assert_response :unprocessable_entity
      end
    end
  end

  test "event payment draft and publish create actor target revision audit atomically" do
    assert_difference("AdministrativeAudit.count", 1) do
      patch admin_event_path(@event), params: { event: { bank_name: "Approved test bank", receipt_email: "approved@example.test", lock_version: @event.lock_version } }
    end
    assert_redirected_to admin_events_path
    audit = AdministrativeAudit.last
    assert_equal @admin.id, audit.actor_id
    assert_equal "Event", audit.target_type
    assert_equal @event.id, audit.target_id
    assert_equal @event.reload.revision, audit.revision
    assert_equal "event_draft_update", audit.action
    @event.prepare_preview!
    assert_difference("AdministrativeAudit.count", 1) { post publish_admin_event_path(@event), params: { revision: @event.revision } }
    assert_redirected_to event_path(@event)
    assert_equal "event_publish", AdministrativeAudit.last.action
    assert_equal @event.reload.published_revision, AdministrativeAudit.last.revision
  end

  test "audit failure rolls back event publish and bank changes" do
    @event.prepare_preview!
    before = @event.reload.attributes
    with_audit_failure do
      post publish_admin_event_path(@event), params: { revision: @event.revision }
      assert_response :unprocessable_entity
      assert_equal before, @event.reload.attributes
      patch admin_event_path(@event), params: { event: { account_number: "BLOCKED-TEST", lock_version: @event.lock_version } }
      assert_response :unprocessable_entity
      assert_equal before, @event.reload.attributes
    end
  end

  test "publication publish and audit commit together and audit failure rolls back" do
    publication = create_ready_publication
    publication.prepare_preview!(expected_lock_version: publication.lock_version)
    before = publication.reload.attributes
    with_audit_failure do
      post publish_admin_publication_path(publication), params: { revision: publication.revision, lock_version: publication.lock_version }
      assert_response :unprocessable_entity
      assert_equal before, publication.reload.attributes
    end
    assert_difference("AdministrativeAudit.count", 1) do
      post publish_admin_publication_path(publication), params: { revision: publication.revision, lock_version: publication.lock_version }
    end
    assert_redirected_to admin_publications_path
    assert_equal "publication_publish", AdministrativeAudit.last.action
    assert_equal publication.reload.published_revision, AdministrativeAudit.last.revision
  end

  test "actor and session are checked inside transaction before mutation" do
    actor = @admin.reload
    authentication = actor.user_sessions.last
    actor.update_columns(role: "member")
    assert_raises(AdministrativeAction::Unauthorized) do
      AdministrativeAction.call(actor: actor, authentication: authentication, target: @event, action: "event_draft_update") { @event.update!(revision: 999) }
    end
    assert_not_equal 999, @event.reload.revision
  end

  test "non demo administrator wording never asks to publish in a demo" do
    previous = ENV["ISP_DEMO_MODE"]
    ENV["ISP_DEMO_MODE"] = "false"
    get admin_events_path
    assert_not_includes response.body, "Admin demo workspace"
    assert_select "a[href=?]", admin_event_interests_path(@event)
    get edit_admin_event_path(@event)
    assert_not_includes response.body, "Sample Bank"
    assert_includes response.body, "Approved bank name"
    @event.prepare_preview!
    get preview_admin_event_path(@event)
    assert_select "button", text: "Publish event", count: 2
    assert_not_includes response.body, "Publish in demo"
  ensure
    ENV["ISP_DEMO_MODE"] = previous
  end

  test "stale MFA event form keeps its original version through verification and repeated retry" do
    original_version = @event.lock_version
    @event.update!(draft_data: @event.draft_data.merge("title" => "Other window event"), revision: @event.revision + 1)
    other_window = @event.reload.attributes
    travel 11.minutes do
      patch admin_event_path(@event), params: { event: { title: "Old window overwrite", lock_version: original_version } }
      assert_response :unprocessable_entity
      assert_equal original_version.to_s, css_select("input[name='event[lock_version]']").first["value"]
      post admin_verification_path, params: { password: "test-password-2026", otp_code: ROTP::TOTP.new(@admin.reload.otp_secret).now }, headers: login_headers
      assert_redirected_to admin_events_path
      2.times do
        patch admin_event_path(@event), params: { event: { title: "Old window overwrite", lock_version: original_version } }
        assert_response :unprocessable_entity
        assert_equal other_window, @event.reload.attributes
        assert_equal original_version.to_s, css_select("input[name='event[lock_version]']").first["value"]
        assert_includes response.body, "changed in another window"
      end
    end
  end

  test "stale MFA publication form keeps its original version through verification and repeated retry" do
    publication = create_publication
    original_version = publication.lock_version
    publication.update!(draft_data: publication.draft_data.merge("title" => "Other window publication"), revision: publication.revision + 1)
    other_window = publication.reload.attributes
    travel 11.minutes do
      patch admin_publication_path(publication), params: { publication: { title: "Old window overwrite", lock_version: original_version } }
      assert_response :unprocessable_entity
      assert_equal original_version.to_s, css_select("input[name='publication[lock_version]']").first["value"]
      post admin_verification_path, params: { password: "test-password-2026", otp_code: ROTP::TOTP.new(@admin.reload.otp_secret).now }, headers: login_headers
      assert_redirected_to admin_events_path
      2.times do
        patch admin_publication_path(publication), params: { publication: { title: "Old window overwrite", lock_version: original_version } }
        assert_response :unprocessable_entity
        assert_equal other_window, publication.reload.attributes
        assert_equal original_version.to_s, css_select("input[name='publication[lock_version]']").first["value"]
        assert_includes response.body, "changed in another window"
      end
    end
  end
  test "a saved incomplete event preview refreshes the form version for correction" do
    patch admin_event_path(@event), params: { intent: "preview", event: { venue: "", lock_version: @event.lock_version } }
    assert_response :unprocessable_entity
    saved = @event.reload
    assert_equal "", saved.draft_data["venue"]
    token = css_select("input[name='event[lock_version]']").first["value"]
    assert_equal saved.lock_version.to_s, token
    patch admin_event_path(saved), params: { intent: "preview", event: { venue: "Corrected approved venue", lock_version: token } }
    assert_redirected_to preview_admin_event_path(saved)
    assert saved.reload.preview_current?
  end

  test "a saved incomplete publication preview refreshes the form version for correction" do
    publication = create_publication
    patch admin_publication_path(publication), params: { intent: "preview", publication: { title: "Saved incomplete publication", lock_version: publication.lock_version } }
    assert_response :unprocessable_entity
    publication.reload
    token = css_select("input[name='publication[lock_version]']").first["value"]
    assert_equal publication.lock_version.to_s, token
    patch admin_publication_path(publication), params: { intent: "preview", publication: { lock_version: token,
      pdf: discover_upload(content: "%PDF-1.7 corrected publication", filename: "book.pdf", type: "application/pdf"), cover: discover_upload } }
    assert_redirected_to preview_admin_publication_path(publication)
    assert publication.reload.preview_current?
  end
  private

  def sign_in_with_mfa
    post session_path, params: { email: @admin.email, password: "test-password-2026" }, headers: login_headers
    assert_redirected_to two_factor_path
    post two_factor_path, params: { otp_code: ROTP::TOTP.new(@admin.reload.otp_secret).now }, headers: login_headers
    assert_redirected_to admin_events_path
  end

  def login_headers = @login_headers ||= { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}::1" }

  def with_audit_failure
    original = AdministrativeAudit.method(:create!)
    AdministrativeAudit.define_singleton_method(:create!) { |*| raise ActiveRecord::RecordInvalid, AdministrativeAudit.new }
    yield
  ensure
    AdministrativeAudit.define_singleton_method(:create!, original)
  end
end

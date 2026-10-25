require "test_helper"

class AdminEventJourneyTest < ActionDispatch::IntegrationTest
  setup { @admin = create_member(role: "admin") }

  test "visitor cannot read or mutate administrator events" do
    event = create_event
    get admin_events_path
    assert_redirected_to login_path
    assert_no_difference("Event.count") { post admin_events_path, params: { event: valid_event_data } }
    assert_redirected_to login_path
    assert_no_changes -> { event.reload.attributes } do
      post publish_admin_event_path(event), params: { revision: event.revision }
    end
    assert_redirected_to login_path
  end

  test "member cannot reach administrator read edit upload preview or publish actions" do
    member = create_member
    event = create_event
    event.prepare_preview!
    sign_in(member)
    [admin_events_path, new_admin_event_path, edit_admin_event_path(event), preview_admin_event_path(event)].each do |path|
      get path
      assert_response :forbidden
    end
    assert_no_difference("Event.count") do
      post admin_events_path, params: { event: valid_event_data }
      assert_response :forbidden
    end
    assert_no_changes -> { event.reload.attributes } do
      patch admin_event_path(event), params: { event: { title: "Forged edit", lock_version: event.lock_version } }
      assert_response :forbidden
      post prepare_preview_admin_event_path(event)
      assert_response :forbidden
      post publish_admin_event_path(event), params: { revision: event.revision }
      assert_response :forbidden
    end
  end

  test "administrator cannot edit a member profile or record member interest" do
    event = create_published_event
    sign_in
    get member_dashboard_path
    assert_response :forbidden
    get edit_member_profile_path
    assert_response :forbidden
    assert_no_changes -> { @admin.reload.attributes } do
      patch member_profile_path, params: { user: { name: "Member-only edit" } }
      assert_response :forbidden
    end
    assert_no_difference("EventInterest.count") do
      post event_interest_path(event), params: { event_interest: { name: @admin.name, email: @admin.email } }
      assert_response :forbidden
    end
  end

  test "administrator saves previews edits re-previews and publishes exactly the reviewed copy" do
    sign_in
    assert_difference("Event.count", 1) { post admin_events_path, params: { event: valid_event_data, intent: "save" } }
    assert_redirected_to admin_events_path
    event = Event.order(:id).last
    assert_not event.published?
    post prepare_preview_admin_event_path(event)
    assert_redirected_to preview_admin_event_path(event)
    event.reload
    assert event.preview_current?
    first_revision = event.revision
    patch admin_event_path(event), params: { event: { title: "Reviewed second revision", lock_version: event.lock_version } }
    assert_redirected_to admin_events_path
    assert_not event.reload.preview_current?
    get preview_admin_event_path(event)
    assert_redirected_to edit_admin_event_path(event)
    post publish_admin_event_path(event), params: { revision: first_revision }
    assert_redirected_to edit_admin_event_path(event)
    assert_not event.reload.published?
    post prepare_preview_admin_event_path(event)
    assert_redirected_to preview_admin_event_path(event)
    reviewed_copy = event.reload.preview_data.deep_dup
    post publish_admin_event_path(event), params: { revision: event.revision }
    assert_redirected_to event_path(event)
    assert_equal reviewed_copy, event.reload.published_data
    assert_nil event.preview_data
    get event_path(event)
    assert_response :success
    assert_includes response.body, "Reviewed second revision"
    patch admin_event_path(event), params: { event: { title: "Private third revision", lock_version: event.lock_version } }
    assert_redirected_to admin_events_path
    get event_path(event)
    assert_includes response.body, "Reviewed second revision"
    assert_not_includes response.body, "Private third revision"
  end

  test "missing stale or malformed edit lock cannot overwrite a saved draft" do
    event = create_event
    sign_in
    [nil, "malformed", event.lock_version - 1].each do |token|
      before = event.reload.attributes
      patch admin_event_path(event), params: { event: { title: "Overwrite attempt", lock_version: token } }
      assert_response :unprocessable_entity
      assert_equal before, event.reload.attributes
    end
  end

  test "incomplete event cannot be previewed or published through direct requests" do
    event = create_event(title: "", date: "", venue: "")
    sign_in
    post prepare_preview_admin_event_path(event)
    assert_redirected_to edit_admin_event_path(event)
    assert_not event.reload.preview_current?
    post publish_admin_event_path(event), params: { revision: event.revision }
    assert_redirected_to edit_admin_event_path(event)
    assert_not event.reload.published?
  end

  private

  def sign_in(user = @admin)
    post session_path, params: { email: user.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
  end
end

require "test_helper"
require "stringio"

class EventFileAccessTest < ActionDispatch::IntegrationTest
  setup do
    @event = create_event
    @blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new("%PDF-1.7 sample"), filename: "private-sample.pdf", content_type: "application/pdf", identify: false, metadata: { analyzed: true })
    @event.uploads.attach(@blob)
    @file = { "signed_id" => @blob.signed_id, "name" => @blob.filename.to_s, "size" => @blob.byte_size }
    @event.update!(draft_data: @event.draft_data.merge("brochure" => @file))
    @path = event_file_path(event_id: @event.slug, key: @blob.signed_id)
  end

  test "draft files are unavailable to visitors and members but available to administrators" do
    get @path
    assert_response :not_found
    sign_in(create_member)
    get @path
    assert_response :not_found
    sign_in(create_member(role: "admin"))
    get @path
    assert_response :success
    assert_equal "application/pdf", response.media_type
    assert_match(/\Aattachment;/, response.headers["Content-Disposition"])
    assert_equal "nosniff", response.headers["X-Content-Type-Options"]
    assert_includes response.headers["Cache-Control"], "no-store"
    assert_includes response.headers["Cache-Control"], "private"
  end

  test "only files referenced by the public snapshot are public" do
    @event.prepare_preview!
    @event.publish!(expected_revision: @event.revision)
    get @path
    assert_response :success
    assert_includes response.body, "%PDF-1.7"
    assert_match(/\Aattachment;/, response.headers["Content-Disposition"])
    assert_equal "nosniff", response.headers["X-Content-Type-Options"]
    replacement = ActiveStorage::Blob.create_and_upload!(io: StringIO.new("%PDF-1.7 private replacement"), filename: "replacement.pdf", content_type: "application/pdf", identify: false, metadata: { analyzed: true })
    @event.uploads.attach(replacement)
    @event.update!(draft_data: @event.draft_data.merge("brochure" => { "signed_id" => replacement.signed_id, "name" => "replacement.pdf", "size" => replacement.byte_size }), revision: @event.revision + 1)
    get event_file_path(event_id: @event.slug, key: replacement.signed_id)
    assert_response :not_found
    get @path
    assert_response :success
  end

  test "a signed blob id cannot be used under another event or outside its attachment association" do
    @event.prepare_preview!
    @event.publish!(expected_revision: @event.revision)
    unrelated = create_published_event
    get event_file_path(event_id: unrelated.slug, key: @blob.signed_id)
    assert_response :not_found
    unrelated.update!(published_data: unrelated.published_data.merge("brochure" => @file))
    get event_file_path(event_id: unrelated.slug, key: @blob.signed_id)
    assert_response :not_found
    get event_file_path(event_id: @event.slug, key: "invalid-signed-id")
    assert_response :not_found
  end

  test "default Active Storage signed routes cannot bypass draft authorization" do
    get "/rails/active_storage/blobs/redirect/#{@blob.signed_id}/private-sample.pdf"
    assert_response :not_found
    get "/rails/active_storage/blobs/proxy/#{@blob.signed_id}/private-sample.pdf"
    assert_response :not_found
  end

  private

  def sign_in(user)
    post session_path, params: { email: user.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
  end
end


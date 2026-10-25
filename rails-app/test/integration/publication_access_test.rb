require "test_helper"

class PublicationAccessTest < ActionDispatch::IntegrationTest
  setup do
    @member = create_member
    @admin = create_member(role: "admin")
    @publication = create_published_publication(title: "Private member book")
    @draft = create_ready_publication(title: "Unpublished editorial book")
  end

  teardown { close_discover_uploads }

  test "visitors see no private homepage metadata and login returns to the library" do
    get root_path
    assert_response :success
    assert_not_includes response.body, @publication.published_data["title"]
    assert_not_includes response.body, @draft.title
    assert_select "img[src*='/files/cover/']", count: 0
    assert_select "a[href=?]", member_publications_path, minimum: 1
    get member_publications_path
    assert_redirected_to login_path
    sign_in(@member)
    assert_redirected_to member_publications_path
    follow_redirect!
    assert_response :success
    assert_includes response.body, @publication.published_data["title"]
    assert_not_includes response.body, @draft.title
  end

  test "anonymous direct book and cover requests and admin mutations require login" do
    %w[pdf cover].each do |kind|
      get file_path(@publication, kind)
      assert_redirected_to login_path
      get admin_publication_file_path(@draft, kind, @draft.draft_data.dig(kind, "signed_id"), version: "draft")
      assert_redirected_to login_path
    end
    assert_no_difference("Publication.count") do
      post admin_publications_path, params: { publication: publication_data }
      assert_redirected_to login_path
    end
    get member_publication_path(@publication)
    assert_redirected_to login_path
  end

  test "members see published content and authenticated file bytes but cannot edit or see drafts" do
    sign_in(@member)
    get root_path
    assert_includes response.body, @publication.published_data["title"]
    assert_select "img[src=?]", file_path(@publication, "cover"), count: 1
    get member_publication_path(@publication)
    assert_response :success
    assert_select "a[href=?]", file_path(@publication, "pdf"), count: 1
    %w[pdf cover].each do |kind|
      get file_path(@publication, kind)
      assert_response :success
      assert_includes response.headers["Cache-Control"], "no-store"
      assert_includes response.headers["Cache-Control"], "private"
      assert_includes response.headers["Content-Disposition"], kind == "pdf" ? "attachment" : "inline"
    end
    get member_publication_path(@draft)
    assert_response :not_found
    get member_publication_file_path(@draft, "pdf", @draft.draft_data.dig("pdf", "signed_id"))
    assert_response :not_found
    get admin_publications_path
    assert_response :forbidden
    assert_no_changes -> { @publication.reload.attributes } do
      patch admin_publication_path(@publication), params: { publication: { title: "Unauthorised", lock_version: @publication.lock_version } }
      assert_response :forbidden
      post publish_admin_publication_path(@publication), params: { revision: @publication.revision, lock_version: @publication.lock_version }
      assert_response :forbidden
    end
  end

  test "admin can upload edit preview and publish a reviewed issue through forms" do
    sign_in(@admin)
    get admin_publications_path
    assert_response :success
    get new_admin_publication_path
    assert_response :success
    assert_select "input[type=file][name='publication[pdf]']"
    assert_select "input[type=file][name='publication[cover]']"
    assert_difference("Publication.count", 1) do
      post admin_publications_path, params: {
        publication: publication_data(title: "Uploaded book").merge(
          pdf: discover_upload(content: "%PDF-1.7 uploaded", filename: "book.pdf", type: "application/pdf"),
          cover: discover_upload(filename: "book-cover.png")), intent: "preview"
      }
    end
    publication = Publication.order(:id).last
    assert_redirected_to preview_admin_publication_path(publication)
    follow_redirect!
    assert_response :success
    assert_includes response.body, "Uploaded book"
    assert_select "button", text: "Publish to members"
    get edit_admin_publication_path(publication)
    assert_response :success
    patch admin_publication_path(publication), params: { publication: { description: "Reviewed second description", lock_version: publication.lock_version }, intent: "preview" }
    assert_redirected_to preview_admin_publication_path(publication)
    publication.reload
    get preview_admin_publication_path(publication)
    assert_includes response.body, "Reviewed second description"
    post publish_admin_publication_path(publication), params: { revision: publication.revision, lock_version: publication.lock_version }
    assert_redirected_to admin_publications_path
    assert_equal "Reviewed second description", publication.reload.published_data["description"]
    sign_in(@member)
    get member_publication_path(publication)
    assert_response :success
    assert_includes response.body, "Reviewed second description"
  end

  test "later drafts preserve published text and files until republished then old URLs stop" do
    previous_pdf = file_path(@publication, "pdf")
    previous_cover = file_path(@publication, "cover")
    sign_in(@admin)
    patch admin_publication_path(@publication), params: {
      publication: { title: "Private revision", lock_version: @publication.lock_version,
        pdf: discover_upload(content: "%PDF-1.7 replacement", filename: "new.pdf", type: "application/pdf"),
        cover: discover_upload(filename: "new.png") }, intent: "preview"
    }
    @publication.reload
    private_pdf = member_publication_file_path(@publication, "pdf", @publication.draft_data.dig("pdf", "signed_id"))
    sign_in(@member)
    get member_publication_path(@publication)
    assert_includes response.body, "Private member book"
    assert_not_includes response.body, "Private revision"
    get previous_pdf
    assert_response :success
    get private_pdf
    assert_response :not_found
    sign_in(@admin)
    post publish_admin_publication_path(@publication), params: { revision: @publication.revision, lock_version: @publication.lock_version }
    assert_redirected_to admin_publications_path
    sign_in(@member)
    get member_publication_path(@publication)
    assert_includes response.body, "Private revision"
    [previous_pdf, previous_cover].each { |path| get path; assert_response :not_found }
    get private_pdf
    assert_response :success
  end

  test "signed IDs cannot escape publication attachment ownership or default storage routes" do
    other = create_published_publication(title: "Other book")
    key = @publication.published_data.dig("pdf", "signed_id")
    sign_in(@member)
    get member_publication_file_path(other, "pdf", key)
    assert_response :not_found
    other.update!(published_data: other.published_data.merge("pdf" => @publication.published_data["pdf"]))
    get member_publication_file_path(other, "pdf", key)
    assert_response :not_found
    get member_publication_file_path(@publication, "pdf", "invalid-signed-key")
    assert_response :not_found
    get member_publication_file_path(@publication, "unsupported", key)
    assert_response :not_found
    get "/rails/active_storage/blobs/redirect/#{key}/book.pdf"
    assert_response :not_found
    get "/rails/active_storage/blobs/proxy/#{key}/book.pdf"
    assert_response :not_found
    sign_in(@admin)
    get admin_publication_file_path(other, "pdf", key, version: "published")
    assert_response :not_found
  end

  test "admin preview file URLs require the current preview and exact revision" do
    @draft.prepare_preview!(expected_lock_version: @draft.lock_version)
    sign_in(@admin)
    key = @draft.preview_data.dig("pdf", "signed_id")
    path = admin_publication_file_path(@draft, "pdf", key, version: "preview", revision: @draft.preview_revision)
    get path
    assert_response :success
    get admin_publication_file_path(@draft, "pdf", key, version: "preview")
    assert_response :not_found
    get admin_publication_file_path(@draft, "pdf", key, version: "preview", revision: "0oops")
    assert_response :not_found
    get admin_publication_file_path(@draft, "pdf", key, version: "published")
    assert_response :not_found
    patch admin_publication_path(@draft), params: { publication: { title: "New private draft", lock_version: @draft.lock_version }, intent: "draft" }
    assert_redirected_to admin_publications_path
    get path
    assert_response :not_found
    get preview_admin_publication_path(@draft)
    assert_redirected_to edit_admin_publication_path(@draft)
    get admin_publication_file_path(@draft, "pdf", key, version: "draft")
    assert_response :success
    get member_publications_path
    assert_response :forbidden
  end

  test "rejected upload and stale form save cannot change published data or create a blob" do
    sign_in(@admin)
    published = @publication.published_data.deep_dup
    assert_no_difference("ActiveStorage::Blob.count") do
      patch admin_publication_path(@publication), params: { publication: { title: "Rejected title", lock_version: @publication.lock_version,
        pdf: discover_upload(content: "not a pdf", filename: "fake.pdf", type: "application/pdf") }, intent: "preview" }
      assert_response :unprocessable_entity
      assert_includes response.body, "Choose a valid PDF"
    end
    assert_equal published, @publication.reload.published_data
    assert_equal "Private member book", @publication.title
    patch admin_publication_path(@publication), params: { publication: { title: "Stale change", lock_version: "bad" } }
    assert_response :unprocessable_entity
    assert_equal "Private member book", @publication.reload.title
  end

  test "tokenless publication mutations are refused by CSRF protection" do
    sign_in(@admin)
    previous = ApplicationController.allow_forgery_protection
    ApplicationController.allow_forgery_protection = true
    assert_no_difference("Publication.count") do
      post admin_publications_path, params: { publication: publication_data }
      assert_response :unprocessable_entity
    end
    assert_no_changes -> { @draft.reload.published_at } do
      post publish_admin_publication_path(@draft), params: { revision: @draft.revision, lock_version: @draft.lock_version }
      assert_response :unprocessable_entity
    end
  ensure
    ApplicationController.allow_forgery_protection = previous
  end

  test "publication descriptions are escaped and private pages disable Turbo snapshots" do
    @publication.update!(published_data: @publication.published_data.merge("description" => '<script>alert("book")</script>'))
    sign_in(@member)
    get member_publication_path(@publication)
    assert_response :success
    assert_includes response.body, "&lt;script&gt;"
    assert_select "script", text: /alert\(/, count: 0
    assert_select "meta[name='turbo-cache-control'][content='no-cache']", count: 1
    assert_select "form[action=?][data-turbo='false']", session_path, count: 1
    delete session_path
    get member_publication_path(@publication)
    assert_redirected_to login_path
  end

  private

  def file_path(publication, kind)
    member_publication_file_path(publication, kind, publication.published_data.dig(kind, "signed_id"))
  end

  def sign_in(user)
    post session_path, params: { email: user.email, password: "test-password-2026" },
      headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
  end
end

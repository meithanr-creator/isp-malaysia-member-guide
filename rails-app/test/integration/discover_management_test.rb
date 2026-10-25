require "test_helper"
require "stringio"

class DiscoverManagementTest < ActionDispatch::IntegrationTest
  setup do
    @slides = 3.times.map { |index| create_discover_slide(position: index + 1, title: "Discover invitation #{index + 1}") }
    @slide = @slides.first
    @admin = create_member(role: "admin")
  end

  teardown { close_discover_uploads }

  test "visitors cannot open or update the Discover editor" do
    get admin_discover_path
    assert_redirected_to login_path
    assert_no_changes -> { @slide.reload.attributes } do
      patch admin_discover_slide_path(@slide), params: { discover_slide: { title: "Visitor edit", lock_version: @slide.lock_version } }
    end
    assert_redirected_to login_path
  end

  test "members cannot open or mutate the Discover editor" do
    sign_in(create_member)
    get admin_discover_path
    assert_response :forbidden
    assert_no_changes -> { @slide.reload.attributes } do
      patch admin_discover_slide_path(@slide), params: { discover_slide: { title: "Member edit", lock_version: @slide.lock_version } }
    end
    assert_response :forbidden
  end

  test "administrator sees one inline form per fixed slide and no create or delete route" do
    sign_in
    get admin_discover_path
    assert_response :success
    assert_select "form[action^='/admin/discover/']", count: 3
    assert_select "input[name='discover_slide[lock_version]']", count: 3
    assert_no_difference("DiscoverSlide.count") do
      post admin_discover_path, params: { discover_slide: valid_discover_attributes(position: 4) }
      assert_response :not_found
      delete admin_discover_slide_path(@slide)
      assert_response :not_found
    end
  end

  test "all three inline edits appear publicly with the exact website CTA" do
    sign_in
    @slides.each_with_index do |slide, index|
      destination = "https://example.test/card-#{index + 1}?source=isp&topic=field#learn"
      patch admin_discover_slide_path(slide), params: { discover_slide: { tag: "Updated tag #{index + 1}", title: "Updated invitation #{index + 1}", description: "Updated public description #{index + 1}.", website_url: destination, image_alt: "Updated alternative text #{index + 1}", lock_version: slide.lock_version } }
      assert_redirected_to admin_discover_path(anchor: "discover-card-#{slide.id}")
      assert_equal destination, slide.reload.website_url
    end
    delete session_path
    get root_path
    assert_response :success
    assert_select "[data-carousel-target='slide']", count: 3
    assert_select ".discover-card a[target='_blank'][rel~='noopener']", text: "Click to Access Website", count: 3
    @slides.each_with_index do |slide, index|
      assert_select ".discover-card h3", text: "Updated invitation #{index + 1}"
      assert_select ".discover-card a[href=?]", slide.reload.website_url
      assert_select ".discover-card img[alt=?]", "Updated alternative text #{index + 1}"
    end
  end

  test "inline update cannot change a slide slot default asset or another slide" do
    sign_in
    other = @slides.last
    original_other = other.attributes
    patch admin_discover_slide_path(@slide), params: { discover_slide: { title: "Permitted edit", position: 3, id: other.id, default_image: "../../secret", lock_version: @slide.lock_version } }
    assert_response :redirect
    assert_equal 1, @slide.reload.position
    assert_equal "plantation-small.jpg", @slide.default_image
    assert_equal original_other, other.reload.attributes
    assert_equal 3, DiscoverSlide.count
  end

  test "tokenless cross-site Discover update is refused" do
    sign_in
    previous = ApplicationController.allow_forgery_protection
    ApplicationController.allow_forgery_protection = true
    assert_no_changes -> { @slide.reload.attributes } do
      patch admin_discover_slide_path(@slide), params: { discover_slide: { title: "Cross-site edit", lock_version: @slide.lock_version } }
    end
    assert_response :unprocessable_entity
  ensure
    ApplicationController.allow_forgery_protection = previous
  end

  test "unsafe URL or invalid text never becomes public" do
    sign_in
    before = @slide.attributes
    [{ website_url: "javascript:alert(1)" }, { website_url: "https://user:password@example.test/" }, { website_url: "https://example.test/%0aInjected" }, { title: "x" * 141 }].each do |attributes|
      patch admin_discover_slide_path(@slide), params: { discover_slide: attributes.merge(lock_version: @slide.lock_version) }
      assert_response :unprocessable_entity
      assert_select ".discover-inline-preview a[href^='javascript:']", count: 0
      assert_select ".discover-inline-preview a[href*='password']", count: 0
      assert_select ".discover-inline-preview a[href*='%0a']", count: 0
      assert_equal before, @slide.reload.attributes
    end
    get root_path
    assert_select ".discover-card a[href^='javascript:']", count: 0
    assert_select ".discover-card a[href*='password']", count: 0
  end

  test "missing malformed and stale lock tokens cannot overwrite a card" do
    sign_in
    old_lock = @slide.lock_version
    patch admin_discover_slide_path(@slide), params: { discover_slide: { title: "First window saved", lock_version: old_lock } }
    assert_response :redirect
    before = @slide.reload.attributes
    [nil, "malformed", old_lock].each do |token|
      patch admin_discover_slide_path(@slide), params: { discover_slide: { title: "Overwrite attempt", lock_version: token } }
      assert_response :unprocessable_entity
      assert_equal before, @slide.reload.attributes
    end
  end

  test "a rejected replacement upload preserves the saved image and copy" do
    assert DiscoverSlideUpdater.new(@slide).call(attributes: {}, image: discover_upload, expected_lock_version: @slide.lock_version)
    @slide.reload
    before = @slide.attributes
    image_id = @slide.image.blob_id
    image_url = discover_image_path(id: @slide.id, key: @slide.image.blob.signed_id)
    sign_in
    assert_no_difference("ActiveStorage::Blob.count") do
      patch admin_discover_slide_path(@slide), params: { discover_slide: { title: "Rejected copy", image: discover_upload(content: "MZ executable", filename: "pretend.png"), lock_version: @slide.lock_version } }
    end
    assert_response :unprocessable_entity
    assert_equal before, @slide.reload.attributes
    assert_equal image_id, @slide.image.blob_id
    get image_url
    assert_response :success
    get root_path
    assert_select ".discover-card img[src=?]", image_url
  end

  test "current image is public while replaced cross-slide and unattached references are private" do
    sign_in
    patch admin_discover_slide_path(@slide), params: { discover_slide: { image: discover_upload, lock_version: @slide.lock_version } }
    assert_response :redirect
    @slide.reload
    old_blob = @slide.image.blob
    old_path = discover_image_path(id: @slide.id, key: old_blob.signed_id)
    delete session_path
    get old_path
    assert_response :success
    assert_equal "image/png", response.media_type
    assert_includes response.headers["Cache-Control"], "no-store"
    get discover_image_path(id: @slides.last.id, key: old_blob.signed_id)
    assert_response :not_found
    get "/rails/active_storage/blobs/redirect/#{old_blob.signed_id}/sample.png"
    assert_response :not_found
    get "/rails/active_storage/blobs/proxy/#{old_blob.signed_id}/sample.png"
    assert_response :not_found
    orphan = ActiveStorage::Blob.create_and_upload!(io: StringIO.new("unpublished sample"), filename: "unattached.png", content_type: "image/png", identify: false, metadata: { analyzed: true })
    get discover_image_path(id: @slide.id, key: orphan.signed_id)
    assert_response :not_found
    sign_in
    patch admin_discover_slide_path(@slide), params: { discover_slide: { image: discover_upload(filename: "replacement.png"), lock_version: @slide.reload.lock_version } }
    assert_response :redirect
    delete session_path
    get old_path
    assert_response :not_found
    get discover_image_path(id: @slide.id, key: @slide.reload.image.blob.signed_id)
    assert_response :success
  end

  test "admin supplied public slide copy and alternative text are escaped" do
    sign_in
    patch admin_discover_slide_path(@slide), params: { discover_slide: { tag: '<b>Tag</b>', title: '<script>alert("sample")</script>', description: '<img src=x onerror="alert(1)">', image_alt: '" onerror="alert(1)', lock_version: @slide.lock_version } }
    assert_response :redirect
    get root_path
    assert_response :success
    assert_includes response.body, "&lt;script&gt;"
    assert_select ".discover-card script", count: 0
    assert_select ".discover-card img[onerror]", count: 0
    assert_select ".discover-card b", text: "Tag", count: 0
    assert_select ".discover-card a", text: "Click to Access Website", count: 3
  end

  test "homepage handles a test database with no seeded slides without writing data" do
    DiscoverSlide.destroy_all
    assert_no_difference("DiscoverSlide.count") { get root_path }
    assert_response :success
  end

  private

  def sign_in(user = @admin)
    post session_path, params: { email: user.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
  end
end

require "test_helper"

class DiscoverSlideUpdaterTest < ActiveSupport::TestCase
  teardown { close_discover_uploads }

  test "a valid inline edit persists text and advances the lock" do
    slide = create_discover_slide
    previous_lock = slide.lock_version
    assert DiscoverSlideUpdater.new(slide).call(attributes: { "title" => "A new invitation", "website_url" => "https://example.test/new" }, expected_lock_version: previous_lock)
    assert_equal "A new invitation", slide.reload.title
    assert_equal "https://example.test/new", slide.website_url
    assert_operator slide.lock_version, :>, previous_lock
    assert_equal 1, slide.position
  end

  test "an image can be added and retained by a later text-only edit" do
    slide = create_discover_slide
    previous_lock = slide.lock_version
    assert DiscoverSlideUpdater.new(slide).call(attributes: {}, image: discover_upload, expected_lock_version: slide.lock_version)
    assert slide.reload.image.attached?
    assert_operator slide.lock_version, :>, previous_lock
    image_id = slide.image.blob_id
    assert DiscoverSlideUpdater.new(slide).call(attributes: { "title" => "Text update" }, expected_lock_version: slide.lock_version)
    assert_equal image_id, slide.reload.image.blob_id
  end

  test "a no-op save advances the token and invalidates an earlier editor" do
    slide = create_discover_slide
    previous_lock = slide.lock_version
    assert DiscoverSlideUpdater.new(slide).call(attributes: {}, expected_lock_version: previous_lock)
    assert_operator slide.reload.lock_version, :>, previous_lock
    assert_not DiscoverSlideUpdater.new(slide).call(attributes: { "title" => "Earlier editor" }, expected_lock_version: previous_lock)
    assert_equal "Knowledge grows together", slide.reload.title
  end

  test "stale missing and malformed locks do not change text or upload a replacement" do
    slide = create_discover_slide
    assert DiscoverSlideUpdater.new(slide).call(attributes: {}, image: discover_upload, expected_lock_version: slide.lock_version)
    before = slide.reload.attributes
    image_id = slide.image.blob_id
    [nil, "invalid", slide.lock_version - 1].each do |token|
      assert_no_difference("ActiveStorage::Blob.count") do
        assert_not DiscoverSlideUpdater.new(slide).call(attributes: { "title" => "Stale overwrite" }, image: discover_upload(filename: "replacement.png"), expected_lock_version: token)
      end
      assert_equal before, slide.reload.attributes
      assert_equal image_id, slide.image.blob_id
    end
  end

  test "rejected image preserves the current image and all saved fields" do
    slide = create_discover_slide
    assert DiscoverSlideUpdater.new(slide).call(attributes: {}, image: discover_upload, expected_lock_version: slide.lock_version)
    before = slide.reload.attributes
    image_id = slide.image.blob_id
    invalid = discover_upload(content: "MZ executable", filename: "pretend.png", type: "image/png")
    assert_no_difference("ActiveStorage::Blob.count") do
      assert_not DiscoverSlideUpdater.new(slide).call(attributes: { "title" => "Should not save" }, image: invalid, expected_lock_version: slide.lock_version)
    end
    assert slide.errors.any?
    assert_equal before, slide.reload.attributes
    assert_equal image_id, slide.image.blob_id
  end

  test "invalid copy or URL is rejected before a valid image is stored" do
    slide = create_discover_slide
    before = slide.attributes
    [{ "title" => "x" * 141 }, { "website_url" => "javascript:alert(1)" }].each do |attributes|
      assert_no_difference("ActiveStorage::Blob.count") do
        assert_not DiscoverSlideUpdater.new(slide).call(attributes: attributes, image: discover_upload, expected_lock_version: slide.lock_version)
      end
      assert_equal before, slide.reload.attributes
      assert_not slide.image.attached?
    end
  end

  test "oversized and unsupported image uploads are refused" do
    slide = create_discover_slide
    [discover_upload(content: "\x89PNG\r\n\x1A\n".b + "a" * 5.megabytes), discover_upload(content: "<svg></svg>", filename: "vector.svg", type: "image/svg+xml")].each do |file|
      assert_no_difference("ActiveStorage::Blob.count") do
        assert_not DiscoverSlideUpdater.new(slide).call(attributes: {}, image: file, expected_lock_version: slide.lock_version)
      end
      assert_not slide.reload.image.attached?
    end
  end
end

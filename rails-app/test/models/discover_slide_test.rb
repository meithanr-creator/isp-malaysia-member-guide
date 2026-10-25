require "test_helper"

class DiscoverSlideTest < ActiveSupport::TestCase
  test "the three fixed slide positions are ordered and unique" do
    third = create_discover_slide(position: 3)
    first = create_discover_slide(position: 1)
    second = create_discover_slide(position: 2)
    assert_equal [first.id, second.id, third.id], DiscoverSlide.ordered.pluck(:id)
    duplicate = DiscoverSlide.new(valid_discover_attributes(position: 2))
    assert_not duplicate.valid?
    assert duplicate.errors[:position].present?
    [0, 4].each do |position|
      assert_not DiscoverSlide.new(valid_discover_attributes(position: position)).valid?
    end
  end

  test "database prevents duplicate slide positions independently of validation" do
    slide = create_discover_slide
    values = slide.attributes.except("id")
    assert_raises(ActiveRecord::RecordNotUnique) { DiscoverSlide.insert_all!([values]) }
  end

  test "slide text and image alternative text are required and bounded" do
    { tag: 80, title: 140, description: 700, image_alt: 180 }.each do |field, maximum|
      missing = DiscoverSlide.new(valid_discover_attributes(field => ""))
      assert_not missing.valid?, "#{field} must be required"
      oversized = DiscoverSlide.new(valid_discover_attributes(field => "x" * (maximum + 1)))
      assert_not oversized.valid?, "#{field} must be bounded"
      assert oversized.errors[field].present?
    end
  end

  test "HTTPS website destination preserves a normal query and fragment" do
    slide = create_discover_slide
    assert_equal "https://example.test/discover?topic=planting&source=isp#learn", slide.reload.website_url
  end

  test "unsafe or malformed website destinations are rejected" do
    [
      "javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
      "http://example.test/", "//example.test/", "/events", "https://",
      "https://user:password@example.test/", "https://trusted.test\\@outside.test/",
      "https://example.test/\r\nInjected: yes", "https://example.test/%0aInjected",
      "https://example.test/%0DInjected", "https://example.test/%00", "https://example.test/a b",
      "https://example.test:0/", "https://example.test:65536/"
    ].each do |url|
      slide = DiscoverSlide.new(valid_discover_attributes(website_url: url))
      assert_not slide.valid?, "unsafe destination accepted: #{url.inspect}"
      assert slide.errors[:website_url].present?, url.inspect
    end
  end

  test "website destination length and default image whitelist are enforced" do
    slide = DiscoverSlide.new(valid_discover_attributes(website_url: "https://example.test/" + "a" * 2048))
    assert_not slide.valid?
    assert slide.errors[:website_url].present?
    slide = DiscoverSlide.new(valid_discover_attributes(default_image: "../../private-image.png"))
    assert_not slide.valid?
    assert slide.errors[:default_image].present?
  end
end

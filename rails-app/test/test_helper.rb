ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    # Keep SQLite writes and request security configuration isolated.
    parallelize(workers: 1)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end

module Phase2TestData
  def member_attributes(overrides = {})
    {
      name: "Alex Sample", email: "alex-#{SecureRandom.hex(4)}@example.test",
      password: "test-password-2026", password_confirmation: "test-password-2026",
      role: "member", company: "Sample Estate", branch: "Sample branch", phone: "0101234567"
    }.merge(overrides)
  end

  def create_member(overrides = {}) = User.create!(member_attributes(overrides))

  def valid_event_data(overrides = {})
    {
      "title" => "Estate Leadership Exchange", "format" => "Workshop",
      "summary" => "A sample knowledge exchange for plantation members.",
      "description" => "Discuss practical leadership with fellow members.",
      "audience" => "Estate managers", "programme" => "09:00 Welcome\n10:00 Discussion",
      "date" => "2027-02-15", "starts_at" => "09:00", "ends_at" => "12:00",
      "timezone" => "Asia/Kuala_Lumpur", "venue" => "Sample Conference Centre",
      "venue_details" => "Meeting room 2", "admission" => "free", "fee" => "",
      "payment_method" => "bank", "bank_name" => "", "account_name" => "",
      "account_number" => "", "receipt_email" => "", "payment_notes" => "", "images" => []
    }.merge(overrides.stringify_keys)
  end

  def create_event(overrides = {})
    Event.create!(slug: "sample-#{SecureRandom.hex(4)}", draft_data: valid_event_data(overrides), revision: 1)
  end

  def create_published_event(overrides = {})
    create_event(overrides).tap do |event|
      event.prepare_preview!
      event.publish!(expected_revision: event.revision)
      event.reload
    end
  end

  def valid_discover_attributes(overrides = {})
    {
      position: 1, tag: "Our community", title: "Knowledge grows together",
      description: "Meet the people and ideas shaping the plantation profession.",
      website_url: "https://example.test/discover?topic=planting&source=isp#learn",
      image_alt: "A sample plantation landscape", default_image: "plantation-small.jpg"
    }.merge(overrides)
  end

  def create_discover_slide(overrides = {}) = DiscoverSlide.create!(valid_discover_attributes(overrides))

  def discover_upload(content: nil, filename: "sample.png", type: "image/png")
    require "tempfile"
    require "base64"
    content ||= Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aH9UAAAAASUVORK5CYII=")
    tempfile = Tempfile.new(["discover-test", File.extname(filename)])
    tempfile.binmode
    tempfile.write(content)
    tempfile.rewind
    (@discover_tempfiles ||= []) << tempfile
    Rack::Test::UploadedFile.new(tempfile.path, type, true, original_filename: filename)
  end

  def close_discover_uploads
    Array(@discover_tempfiles).each(&:close!)
  end
end

ActiveSupport::TestCase.include Phase2TestData

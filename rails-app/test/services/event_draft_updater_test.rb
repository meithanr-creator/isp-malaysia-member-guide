require "test_helper"
require "tempfile"

class EventDraftUpdaterTest < ActiveSupport::TestCase
  teardown { Array(@upload_files).each(&:close!) }

  test "saving an edit increments revision and invalidates the reviewed preview" do
    event = create_event
    event.prepare_preview!
    revision = event.revision
    assert EventDraftUpdater.new(event).call(attributes: { "title" => "Revised draft" }, expected_lock_version: event.lock_version)
    assert_equal revision + 1, event.reload.revision
    assert_equal "Revised draft", event.draft_data.fetch("title")
    assert_not event.preview_current?
    assert_nil event.preview_data
  end

  test "stale editor cannot overwrite another window or revoke its preview" do
    event = create_event
    old_lock = event.lock_version
    EventDraftUpdater.new(event).call(attributes: { "title" => "Saved in first window" }, expected_lock_version: old_lock)
    event.prepare_preview!
    expected = event.reload.attributes.slice("draft_data", "preview_data", "preview_revision", "revision", "lock_version")
    assert_not EventDraftUpdater.new(event).call(attributes: { "title" => "Stale replacement" }, expected_lock_version: old_lock)
    assert_match(/another window/, event.errors.full_messages.join)
    assert_equal expected, event.reload.attributes.slice(*expected.keys)
  end

  test "editing an already published event keeps its public copy intact" do
    event = create_published_event
    public_copy = event.published_data.deep_dup
    assert EventDraftUpdater.new(event).call(attributes: { "title" => "Private revision" }, expected_lock_version: event.lock_version)
    assert_equal public_copy, event.reload.published_data
    assert_equal "Private revision", event.draft_data.fetch("title")
  end

  test "invalid files are rejected before storage and cannot create a publishable preview" do
    event = create_event
    event.prepare_preview!
    revision = event.revision
    file = upload("MZ executable", "pretend.png", "image/png")
    assert_no_difference("ActiveStorage::Blob.count") do
      assert_not EventDraftUpdater.new(event).call(attributes: {}, images: [file], expected_lock_version: event.lock_version)
    end
    assert_match(/valid JPG, PNG or WebP/, event.errors.full_messages.join)
    assert_equal revision, event.reload.revision
    assert_equal [], event.draft_data.fetch("images")
    assert_not event.preview_current?
  end

  test "images and brochure are stored by signed reference and removed only from the draft" do
    event = create_event
    file = upload("\x89PNG\r\n\x1A\nsample".b, "sample.png", "image/png")
    pdf = upload("%PDF-1.7 sample", "sample.pdf", "application/pdf")
    assert EventDraftUpdater.new(event).call(attributes: {}, images: [file], brochure: pdf, expected_lock_version: event.lock_version)
    event.reload
    image = event.draft_data.fetch("images").first
    brochure = event.draft_data.fetch("brochure")
    assert_equal "sample.png", image.fetch("name")
    assert ActiveStorage::Blob.find_signed(image.fetch("signed_id"))
    assert_equal "sample.pdf", brochure.fetch("name")
    event.prepare_preview!
    event.publish!(expected_revision: event.revision)
    published = event.published_data.deep_dup
    assert EventDraftUpdater.new(event).call(attributes: {}, remove_images: ["0"], remove_brochure: true, expected_lock_version: event.lock_version)
    assert_equal [], event.reload.draft_data.fetch("images")
    assert_nil event.draft_data.fetch("brochure")
    assert_equal published, event.published_data
  end

  test "more than three images are rejected without creating blobs" do
    event = create_event(images: 3.times.map { |index| { "name" => "existing-#{index}.png", "signed_id" => "sample" } })
    file = upload("\x89PNG\r\n\x1A\nsample".b, "extra.png", "image/png")
    assert_no_difference("ActiveStorage::Blob.count") do
      assert_not EventDraftUpdater.new(event).call(attributes: {}, images: [file], expected_lock_version: event.lock_version)
    end
    assert_match(/up to three/, event.errors.full_messages.join)
    assert_equal 3, event.reload.draft_data.fetch("images").size
  end

  test "excessive image counts do not scan any image or brochure or change the draft" do
    event = create_event
    original = event.attributes
    files = 4.times.map { |index| upload("\x89PNG\r\n\x1A\nsample".b, "too-many-#{index}.png", "image/png") }
    pdf = upload("%PDF-1.7 sample", "not-scanned.pdf", "application/pdf")
    scanner_calls = 0
    original_scan = UploadScanner.method(:error)
    begin
      UploadScanner.define_singleton_method(:error) { |_file| scanner_calls += 1; nil }
      assert_no_difference("ActiveStorage::Blob.count") do
        assert_not EventDraftUpdater.new(event).call(attributes: { "title" => "Rejected copy" }, images: files, brochure: pdf, expected_lock_version: event.lock_version)
      end
    ensure
      UploadScanner.define_singleton_method(:error, original_scan)
    end
    assert_equal 0, scanner_calls
    assert_match(/up to three/, event.errors.full_messages.join)
    assert_equal original, event.reload.attributes
  end
  private

  def upload(content, filename, type)
    tempfile = Tempfile.new(["phase2-upload", File.extname(filename)])
    tempfile.binmode
    tempfile.write(content)
    tempfile.rewind
    (@upload_files ||= []) << tempfile
    ActionDispatch::Http::UploadedFile.new(tempfile: tempfile, filename: filename, type: type)
  end
end


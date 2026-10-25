require "test_helper"

class PublicationTest < ActiveSupport::TestCase
  teardown { close_discover_uploads }

  test "publication requires an exact current preview and consumes it on publish" do
    publication = create_ready_publication
    assert_raises(Publication::InvalidTransition) do
      publication.publish!(expected_revision: publication.revision, expected_lock_version: publication.lock_version)
    end
    publication.prepare_preview!(expected_lock_version: publication.lock_version)
    assert publication.preview_current?
    snapshot = publication.preview_data.deep_dup
    publication.publish!(expected_revision: publication.revision, expected_lock_version: publication.lock_version)
    assert publication.reload.published?
    assert_equal snapshot, publication.published_data
    assert_equal publication.revision, publication.published_revision
    assert_nil publication.preview_data
    assert_nil publication.preview_revision
  end

  test "preview and publish reject missing malformed and stale lock tokens" do
    publication = create_ready_publication
    [nil, "invalid", publication.lock_version - 1].each do |token|
      assert_raises(Publication::InvalidTransition) { publication.prepare_preview!(expected_lock_version: token) }
    end
    previous_lock = publication.lock_version
    publication.prepare_preview!(expected_lock_version: previous_lock)
    [nil, "invalid", previous_lock].each do |token|
      assert_raises(Publication::InvalidTransition) { publication.publish!(expected_revision: publication.revision, expected_lock_version: token) }
    end
    assert_not publication.reload.published?
  end

  test "publish refuses an unreviewed revision without changing the reviewed snapshot" do
    publication = create_ready_publication
    publication.prepare_preview!(expected_lock_version: publication.lock_version)
    reviewed = publication.preview_data.deep_dup
    assert_raises(Publication::InvalidTransition) do
      publication.publish!(expected_revision: publication.revision + 1, expected_lock_version: publication.lock_version)
    end
    assert_equal reviewed, publication.reload.preview_data
    assert_not publication.published?
  end

  test "a publication without both associated files cannot be previewed" do
    publication = create_publication
    assert_raises(Publication::InvalidTransition) { publication.prepare_preview!(expected_lock_version: publication.lock_version) }
    assert_nil publication.reload.preview_data
    assert_not publication.published?
  end

  test "required copy and field length limits are enforced" do
    { "title" => 160, "subtitle" => 200, "description" => 4000, "author" => 140 }.each do |field, maximum|
      candidate = Publication.new(draft_data: publication_data(field => "x" * (maximum + 1)))
      assert_not candidate.valid?, "oversized #{field} accepted"
    end
    publication = create_ready_publication(title: "", description: "")
    assert_raises(Publication::InvalidTransition) { publication.prepare_preview!(expected_lock_version: publication.lock_version) }
  end

  test "an invalid issue date cannot reach a published snapshot" do
    publication = create_ready_publication
    PublicationDraftUpdater.new(publication).call(attributes: { "issue_date" => "2026-02-30" }, expected_lock_version: publication.lock_version)
    if publication.reload.draft_data["issue_date"] == "2026-02-30"
      assert_raises(Publication::InvalidTransition) { publication.prepare_preview!(expected_lock_version: publication.lock_version) }
    end
    assert_not publication.reload.published?
  end

  test "a signed file reference from another publication cannot satisfy preview validation" do
    source = create_ready_publication
    candidate = create_publication
    candidate.update!(draft_data: candidate.draft_data.merge("pdf" => source.draft_data["pdf"], "cover" => source.draft_data["cover"]))
    assert_raises(Publication::InvalidTransition) { candidate.prepare_preview!(expected_lock_version: candidate.lock_version) }
    assert_not candidate.reload.preview_current?
  end
end

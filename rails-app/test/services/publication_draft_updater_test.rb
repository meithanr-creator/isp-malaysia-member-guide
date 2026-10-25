require "test_helper"

class PublicationDraftUpdaterTest < ActiveSupport::TestCase
  teardown { close_discover_uploads }

  test "saving a new revision invalidates preview and preserves the published copy" do
    publication = create_published_publication
    public_copy = publication.published_data.deep_dup
    publication.prepare_preview!(expected_lock_version: publication.lock_version)
    previous_revision = publication.revision
    assert PublicationDraftUpdater.new(publication).call(attributes: { "title" => "Private replacement" }, expected_lock_version: publication.lock_version)
    assert_equal previous_revision + 1, publication.reload.revision
    assert_nil publication.preview_data
    assert_nil publication.preview_revision
    assert_equal public_copy, publication.published_data
  end

  test "stale edits cannot change fields files or the current preview" do
    publication = create_ready_publication
    stale_lock = publication.lock_version
    publication.prepare_preview!(expected_lock_version: publication.lock_version)
    before = publication.reload.attributes
    [nil, "invalid", stale_lock].each do |token|
      assert_no_difference("ActiveStorage::Blob.count") do
        assert_not PublicationDraftUpdater.new(publication).call(attributes: { "title" => "Stale replacement" }, cover: discover_upload, expected_lock_version: token)
      end
      assert_equal before, publication.reload.attributes
    end
  end

  test "invalid upload invalidates preview while retaining saved and published file references" do
    publication = create_published_publication
    publication.prepare_preview!(expected_lock_version: publication.lock_version)
    draft = publication.draft_data.deep_dup
    public_copy = publication.published_data.deep_dup
    assert_no_difference("ActiveStorage::Blob.count") do
      assert_not PublicationDraftUpdater.new(publication).call(attributes: { "title" => "Rejected replacement" },
        pdf: discover_upload(content: "MZ executable", filename: "pretend.pdf", type: "application/pdf"), expected_lock_version: publication.lock_version)
    end
    assert_equal draft, publication.reload.draft_data
    assert_equal public_copy, publication.published_data
    assert_not publication.preview_current?
  end

  test "PDFs between ten and twenty five MB are accepted and larger files are rejected" do
    publication = create_ready_publication
    pdf = discover_upload(content: "%PDF-1.7\n" + "a" * 11.megabytes, filename: "large-valid.pdf", type: "application/pdf")
    assert PublicationDraftUpdater.new(publication).call(attributes: {}, pdf: pdf, expected_lock_version: publication.lock_version)
    assert_operator publication.reload.file_blob(publication.draft_data["pdf"], kind: :pdf).byte_size, :>, 10.megabytes
    before = publication.draft_data.deep_dup
    oversized = discover_upload(content: "%PDF-1.7\n" + "a" * 25.megabytes, filename: "oversized.pdf", type: "application/pdf")
    assert_no_difference("ActiveStorage::Blob.count") do
      assert_not PublicationDraftUpdater.new(publication).call(attributes: {}, pdf: oversized, expected_lock_version: publication.lock_version)
    end
    assert_equal before, publication.reload.draft_data
  end

  test "PDF type cover type and cover size are validated before storage" do
    publication = create_ready_publication
    [{ pdf: discover_upload(content: "%PDF-1.7 sample", filename: "wrong.pdf", type: "text/plain") },
      { cover: discover_upload(content: "<svg></svg>", filename: "cover.svg", type: "image/svg+xml") },
      { cover: discover_upload(content: "\x89PNG\r\n\x1A\n".b + "a" * 5.megabytes) }].each do |files|
      assert_no_difference("ActiveStorage::Blob.count") do
        assert_not PublicationDraftUpdater.new(publication).call(attributes: {}, **files, expected_lock_version: publication.lock_version)
      end
      publication.reload
    end
  end

  test "removing draft files does not remove the published snapshot" do
    publication = create_published_publication
    public_copy = publication.published_data.deep_dup
    assert PublicationDraftUpdater.new(publication).call(attributes: {}, remove_pdf: true, remove_cover: true, expected_lock_version: publication.lock_version)
    assert_nil publication.reload.draft_data["pdf"]
    assert_nil publication.draft_data["cover"]
    assert_equal public_copy, publication.published_data
    assert_raises(Publication::InvalidTransition) { publication.prepare_preview!(expected_lock_version: publication.lock_version) }
  end
end

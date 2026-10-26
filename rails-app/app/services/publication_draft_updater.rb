class PublicationDraftUpdater
  attr_reader :publication
  def initialize(publication) = @publication = publication

  def call(attributes:, pdf: nil, cover: nil, remove_pdf: false,
      remove_cover: false, expected_lock_version: nil, uploads: nil)
    unless uploads
      operation = UploadOperation.for_publication(pdf: pdf, cover: cover)
      return operation.run do |prepared|
        call(attributes: attributes, pdf: pdf, cover: cover,
          remove_pdf: remove_pdf, remove_cover: remove_cover,
          expected_lock_version: expected_lock_version, uploads: prepared)
      end
    end

    publication.with_lock do
      unless expected_lock_version.to_s.match?(/\A\d+\z/) &&
          expected_lock_version.to_i == publication.lock_version
        publication.errors.add(:base, "This draft changed in another window. Reload it before saving again.")
        return false
      end

      data = publication.draft_data.deep_dup
      values = attributes.to_h.stringify_keys
      Publication::FIELDS.each do |field|
        data[field] = values[field].to_s.strip if values.key?(field)
      end
      data["pdf"] = nil if remove_pdf
      data["cover"] = nil if remove_cover
      publication.draft_data = data
      publication.valid?
      uploads.apply_errors(publication)
      return false if publication.errors.any?

      blobs = uploads.slots.map do |kind|
        blob = uploads.upload(kind)
        data[kind] = {
          "signed_id" => blob.signed_id,
          "name" => blob.filename.to_s,
          "size" => blob.byte_size
        }
        blob
      end
      publication.uploads.attach(blobs) if blobs.any?
      publication.draft_data = data
      publication.revision += 1
      publication.preview_data = nil
      publication.preview_revision = nil
      publication.save!
    end
  end
end

class PublicationDraftUpdater
  attr_reader :publication
  def initialize(publication) = @publication = publication

  def call(attributes:, pdf: nil, cover: nil, remove_pdf: false, remove_cover: false, expected_lock_version: nil)
    files = { "pdf" => pdf, "cover" => cover }.reject { |_kind, file| file.blank? }
    file_errors = files.filter_map { |kind, file| message = PublicationFileValidator.error(file, kind: kind); [kind, message] if message }
    publication.with_lock do
      unless expected_lock_version.to_s.match?(/\A\d+\z/) && expected_lock_version.to_i == publication.lock_version
        publication.errors.add(:base, "This draft changed in another window. Reload it before saving again.")
        return false
      end
      publication.update!(preview_data: nil, preview_revision: nil) if publication.preview_data.present?
      data = publication.draft_data.deep_dup
      attributes = attributes.to_h.stringify_keys
      Publication::FIELDS.each { |field| data[field] = attributes[field].to_s.strip if attributes.key?(field) }
      data["pdf"] = nil if remove_pdf
      data["cover"] = nil if remove_cover
      publication.draft_data = data
      publication.valid?
      file_errors.each { |kind, message| publication.errors.add(kind, message) }
      return false if publication.errors.any?
      blobs = []
      files.each do |kind, file|
        blob = ActiveStorage::Blob.create_and_upload!(io: file.tempfile, filename: file.original_filename, content_type: file.content_type, identify: false, metadata: { analyzed: true })
        blobs << blob
        data[kind] = { "signed_id" => blob.signed_id, "name" => blob.filename.to_s, "size" => blob.byte_size }
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

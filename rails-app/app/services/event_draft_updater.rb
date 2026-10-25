class EventDraftUpdater
  attr_reader :event
  def initialize(event) = @event = event

  def call(attributes:, images: [], brochure: nil, remove_images: [], remove_brochure: false, expected_lock_version: nil)
    images = Array(images).reject(&:blank?).select { |file| file.respond_to?(:original_filename) }
    new_data = (event.draft_data || {}).deep_dup
    Event::FIELDS.each { |field| new_data[field] = attributes[field].to_s.strip if attributes.key?(field) }
    new_data["images"] ||= []
    removed = remove_images.map(&:to_s)
    new_data["images"] = new_data["images"].each_with_index.reject { |_image, index| removed.include?(index.to_s) }.map(&:first)
    new_data["brochure"] = nil if remove_brochure
    upload_errors = images.filter_map { |file| LocalFileValidator.error(file, kind: :image) }
    upload_errors << "Choose up to three event images in total." if new_data["images"].size + images.size > 3
    upload_errors << LocalFileValidator.error(brochure, kind: :pdf) if brochure.present?
    upload_errors.compact!
    event.with_lock do
      if !expected_lock_version.to_s.match?(/\A\d+\z/) || event.lock_version != expected_lock_version.to_i
        event.errors.add(:base, "This draft changed in another window. Reload it before editing again.")
        return false
      end
      event.update!(preview_data: nil, preview_revision: nil) if event.preview_data.present?
      event.draft_data = new_data
      if upload_errors.any?
        upload_errors.each { |message| event.errors.add(:base, message) }
        return false
      end
      images.each { |file| new_data["images"] << store_file(file) }
      new_data["brochure"] = store_file(brochure) if brochure.present?
      event.draft_data = new_data
      event.revision += 1
      event.preview_data = nil
      event.preview_revision = nil
      event.save
    end
  end

  private
  def store_file(file)
    blob = ActiveStorage::Blob.create_and_upload!(io: file.tempfile, filename: file.original_filename, content_type: file.content_type, identify: false, metadata: { analyzed: true })
    event.uploads.attach(blob)
    { "signed_id" => blob.signed_id, "name" => blob.filename.to_s, "size" => blob.byte_size }
  end
end

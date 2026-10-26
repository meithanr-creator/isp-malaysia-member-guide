class EventDraftUpdater
  attr_reader :event
  def initialize(event) = @event = event

  def call(attributes:, images: [], brochure: nil, remove_images: [],
      remove_brochure: false, expected_lock_version: nil, uploads: nil)
    unless uploads
      operation = UploadOperation.for_event(event, images: images,
        brochure: brochure, remove_images: remove_images)
      return operation.run do |prepared|
        call(attributes: attributes, images: images, brochure: brochure,
          remove_images: remove_images, remove_brochure: remove_brochure,
          expected_lock_version: expected_lock_version, uploads: prepared)
      end
    end

    event.with_lock do
      unless expected_lock_version.to_s.match?(/\A\d+\z/) &&
          event.lock_version == expected_lock_version.to_i
        event.errors.add(:base, "This draft changed in another window. Reload it before editing again.")
        return false
      end

      data = (event.draft_data || {}).deep_dup
      Event::FIELDS.each do |field|
        data[field] = attributes[field].to_s.strip if attributes.key?(field)
      end
      removed = Array(remove_images).map(&:to_s)
      data["images"] = Array(data["images"]).each_with_index
        .reject { |_image, index| removed.include?(index.to_s) }.map(&:first)
      data["brochure"] = nil if remove_brochure
      event.draft_data = data
      event.valid?
      uploads.apply_errors(event)

      image_slots = uploads.slots.grep(/\Aimage_\d+\z/)
      if data["images"].length + image_slots.length > 3
        event.errors.add(:base, "Choose up to three event images in total.")
      end
      return false if event.errors.any?

      new_blobs = []
      image_slots.each do |slot|
        blob = uploads.upload(slot)
        new_blobs << blob
        data["images"] << snapshot(blob)
      end
      if uploads.slots.include?("brochure")
        blob = uploads.upload("brochure")
        new_blobs << blob
        data["brochure"] = snapshot(blob)
      end
      event.uploads.attach(new_blobs) if new_blobs.any?

      event.draft_data = data
      event.revision += 1
      event.preview_data = nil
      event.preview_revision = nil
      event.save!
    end
  end

  private

  def snapshot(blob)
    { "signed_id" => blob.signed_id, "name" => blob.filename.to_s, "size" => blob.byte_size }
  end
end

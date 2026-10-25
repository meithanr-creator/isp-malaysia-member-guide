class DiscoverSlideUpdater
  attr_reader :slide
  def initialize(slide) = @slide = slide

  def call(attributes:, image: nil, expected_lock_version: nil)
    slide.with_lock do
      unless expected_lock_version.to_s.match?(/\A\d+\z/) && slide.lock_version == expected_lock_version.to_i
        slide.errors.add(:base, "This card was changed in another window. Reload it before saving your changes.")
        return false
      end
      slide.assign_attributes(attributes.to_h.stringify_keys.slice("tag", "title", "description", "website_url", "image_alt"))
      slide.valid?
      if image.present?
        if image.respond_to?(:original_filename)
          file_error = LocalFileValidator.error(image, kind: :image)
          slide.errors.add(:image, file_error) if file_error
        else
          slide.errors.add(:image, "must be a JPG, PNG or WebP file")
        end
      end
      return false if slide.errors.any?
      if image.present?
        # Validate before creating a blob; rejected uploads never replace the current image.
        blob = ActiveStorage::Blob.create_and_upload!(io: image.tempfile, filename: image.original_filename, content_type: image.content_type, identify: false, metadata: { analyzed: true })
        slide.image = blob
      end
      # Advance the edit token even when only the attachment changes or the same text is saved.
      slide.lock_version_will_change!
      slide.save!
    end
  end
end

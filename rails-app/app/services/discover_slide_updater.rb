class DiscoverSlideUpdater
  attr_reader :slide
  def initialize(slide) = @slide = slide

  def call(attributes:, image: nil, expected_lock_version: nil, uploads: nil)
    unless uploads
      operation = UploadOperation.for_discover(image: image)
      return operation.run do |prepared|
        call(attributes: attributes, image: image,
          expected_lock_version: expected_lock_version, uploads: prepared)
      end
    end

    slide.with_lock do
      unless expected_lock_version.to_s.match?(/\A\d+\z/) &&
          slide.lock_version == expected_lock_version.to_i
        slide.errors.add(:base, "This card was changed in another window. Reload it before saving your changes.")
        return false
      end
      slide.assign_attributes(attributes.to_h.stringify_keys.slice(
        "tag", "title", "description", "website_url", "image_alt"))
      slide.valid?
      uploads.apply_errors(slide)
      return false if slide.errors.any?

      slide.image = uploads.upload("image") if uploads.slots.include?("image")
      slide.lock_version_will_change!
      slide.save!
    end
  end
end

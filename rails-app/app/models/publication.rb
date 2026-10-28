class Publication < ApplicationRecord
  class InvalidTransition < StandardError; end
  FIELDS = %w[title subtitle description author issue_date].freeze
  LIMITS = { "title" => 160, "subtitle" => 200, "description" => 4_000, "author" => 140 }.freeze
  IMAGE_TYPES = %w[image/jpeg image/png image/webp].freeze

  serialize :draft_data, coder: JSON
  serialize :preview_data, coder: JSON
  serialize :published_data, coder: JSON
  has_many_attached :uploads
  validates :slug, presence: true, uniqueness: true
  validate :draft_fields
  validate :ready_for_publication, on: :preview
  before_validation :ensure_defaults
  scope :published, -> { where.not(published_at: nil).order(published_at: :desc) }

  def to_param = slug
  def title = draft_data&.fetch("title", "").presence || "Untitled publication"
  def published? = published_at.present? && published_data.present?
  def preview_current? = preview_data.present? && preview_revision == revision
  def clean_snapshot = draft_data.deep_dup

  def prepare_preview!(expected_lock_version:)
    with_lock do
      check_lock!(expected_lock_version)
      raise InvalidTransition, errors.full_messages.to_sentence unless valid?(:preview)
      update!(preview_data: clean_snapshot, preview_revision: revision)
    end
  end

  def publish!(expected_revision:, expected_lock_version:)
    with_lock do
      check_lock!(expected_lock_version)
      unless preview_current? && expected_revision.to_s.match?(/\A\d+\z/) && expected_revision.to_i == revision
        raise InvalidTransition, "The draft has changed. Create a fresh preview before publishing."
      end
      unless valid?(:preview) && preview_data == clean_snapshot
        raise InvalidTransition, errors.full_messages.presence&.to_sentence || "The preview no longer matches this draft. Review it again."
      end
      update!(published_data: preview_data.deep_dup, published_revision: revision, published_at: Time.current, preview_data: nil, preview_revision: nil)
    end
  end

  def file_blob(file, kind:)
    return unless file.is_a?(Hash) && %w[pdf cover].include?(kind.to_s)
    blob = ActiveStorage::Blob.find_signed(file["signed_id"].to_s)
    return unless blob && uploads.blobs.exists?(id: blob.id)
    allowed = kind.to_s == "pdf" ? blob.content_type == "application/pdf" && blob.byte_size.between?(1, 25.megabytes) : IMAGE_TYPES.include?(blob.content_type) && blob.byte_size.between?(1, 5.megabytes)
    blob if allowed && UploadScanner.approved_blob?(blob)
  end

  private

  def check_lock!(token)
    return if token.to_s.match?(/\A\d+\z/) && token.to_i == lock_version
    raise InvalidTransition, "This publication changed in another window. Reload it before continuing."
  end

  def ensure_defaults
    self.slug ||= SecureRandom.hex(8)
    self.draft_data ||= {}
    self.revision ||= 0
  end

  def draft_fields
    LIMITS.each do |field, maximum|
      errors.add(field, "is too long (maximum #{maximum} characters)") if draft_data&.fetch(field, "").to_s.length > maximum
    end
    return if draft_data&.fetch("issue_date", "").blank?
    Date.iso8601(draft_data["issue_date"])
  rescue ArgumentError
    errors.add(:issue_date, "must be a valid publication date")
  end

  def ready_for_publication
    %w[title description].each { |field| errors.add(field, "is required") if draft_data&.fetch(field, "").blank? }
    errors.add(:pdf, "must be a valid attached PDF book (up to 25 MB)") unless file_blob(draft_data&.fetch("pdf", nil), kind: "pdf")
    errors.add(:cover, "must be an attached JPG, PNG or WebP cover (up to 5 MB)") unless file_blob(draft_data&.fetch("cover", nil), kind: "cover")
  end
end

class Event < ApplicationRecord
  class InvalidTransition < StandardError; end
  FORMATS = ["Workshop", "Field visit", "Webinar", "Conference"].freeze
  TIMEZONES = ["Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Jakarta", "UTC"].freeze
  FIELDS = %w[title format summary description audience programme date starts_at ends_at timezone venue venue_details admission fee payment_method bank_name account_name account_number receipt_email payment_notes].freeze
  LIMITS = { "title" => 110, "summary" => 180, "description" => 4_000, "audience" => 240, "programme" => 2_500, "venue" => 180, "venue_details" => 700, "bank_name" => 100, "account_name" => 140, "account_number" => 60, "receipt_email" => 160, "payment_notes" => 1_200 }.freeze

  serialize :draft_data, coder: JSON
  serialize :preview_data, coder: JSON
  serialize :published_data, coder: JSON
  has_many_attached :uploads
  has_many :event_interests, dependent: :destroy
  validates :slug, presence: true, uniqueness: true
  validate :draft_lengths
  validate :ready_for_publication, on: :preview
  before_validation :ensure_defaults
  scope :published, -> { where.not(published_at: nil).order(published_at: :desc) }

  def to_param = slug
  def published? = published_at.present? && published_data.present?
  def title = draft_data&.fetch("title", "").presence || "Untitled event"
  def published_title = published_data&.fetch("title", "")

  def preview_current?
    preview_data.present? && preview_revision == revision
  end

  def prepare_preview!
    with_lock do
      raise InvalidTransition, errors.full_messages.to_sentence unless valid?(:preview)
      update!(preview_data: clean_snapshot, preview_revision: revision)
    end
  end

  def publish!(expected_revision:)
    with_lock do
      unless preview_current? && expected_revision.to_s == revision.to_s
        raise InvalidTransition, "The draft has changed. Create a fresh preview before publishing."
      end
      raise InvalidTransition, errors.full_messages.to_sentence unless valid?(:preview) && preview_data == clean_snapshot
      update!(published_data: preview_data.deep_dup, published_at: Time.current, published_revision: revision, preview_data: nil, preview_revision: nil)
    end
  end

  def clean_snapshot
    draft_data.deep_dup.tap do |data|
      if data["admission"] == "free"
        %w[fee payment_method bank_name account_name account_number receipt_email payment_notes].each { |key| data[key] = "" }
      elsif data["payment_method"] != "bank"
        %w[bank_name account_name account_number].each { |key| data[key] = "" }
      end
    end
  end

  private

  def ensure_defaults
    self.slug ||= SecureRandom.hex(8)
    self.draft_data ||= { "format" => "Workshop", "timezone" => "Asia/Kuala_Lumpur", "admission" => "free", "payment_method" => "bank", "images" => [] }
    self.revision ||= 0
  end

  def draft_lengths
    LIMITS.each do |field, maximum|
      errors.add(field, "is too long (maximum #{maximum} characters)") if draft_data&.fetch(field, "").to_s.length > maximum
    end
  end

  def ready_for_publication
    data = draft_data || {}
    %w[title summary description date starts_at ends_at venue].each do |field|
      errors.add(field, "is required") if data[field].blank?
    end
    errors.add(:format, "must be a supported event format") unless FORMATS.include?(data["format"])
    errors.add(:timezone, "must be a supported time zone") unless TIMEZONES.include?(data["timezone"])
    begin
      Date.iso8601(data["date"].to_s)
    rescue ArgumentError
      errors.add(:date, "must be a valid date")
    end
    %w[starts_at ends_at].each do |field|
      errors.add(field, "must be a valid time") unless data[field].to_s.match?(/\A(?:[01]\d|2[0-3]):[0-5]\d\z/)
    end
    if data["starts_at"].present? && data["ends_at"].present? && data["ends_at"] <= data["starts_at"]
      errors.add(:ends_at, "must be after the start time on the event date")
    end
    errors.add(:admission, "must be free or paid") unless %w[free paid].include?(data["admission"])
    (Array(data["images"]) + [ data["brochure"] ].compact).each do |file|
      blob = file.is_a?(Hash) && ActiveStorage::Blob.find_signed(file["signed_id"].to_s)
      unless blob && uploads.blobs.exists?(id: blob.id) && UploadScanner.approved_blob?(blob)
        errors.add(:base, "An event attachment is missing or has not passed the upload safety check.")
      end
    end
    return unless data["admission"] == "paid"
    fee = BigDecimal(data["fee"].to_s, exception: false)
    errors.add(:fee, "must be between RM 0.01 and RM 100,000, with up to two decimal places") unless fee&.finite? && fee >= 0.01 && fee <= 100_000 && data["fee"].to_s.match?(/\A\d+(?:\.\d{1,2})?\z/)
    errors.add(:payment_method, "must be selected") unless %w[bank organiser].include?(data["payment_method"])
    if data["payment_method"] == "bank"
      %w[bank_name account_name account_number].each { |field| errors.add(field, "is required for bank transfer") if data[field].blank? }
    end
    errors.add(:receipt_email, "must be a valid company email") unless data["receipt_email"].to_s.match?(URI::MailTo::EMAIL_REGEXP)
  end
end

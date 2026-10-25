class DiscoverSlide < ApplicationRecord
  DEFAULT_IMAGES = %w[plantation-small.jpg planter-cover.jpg member-events.jpg].freeze
  DEFAULTS = [
    { position: 1, tag: "A profession. A community.", title: "Rooted in the field. Looking to the future.", description: "Since 1919, ISP has connected planters through knowledge, professional fellowship and a shared commitment to progress.", website_url: "https://isp.org.my/v4/", image_alt: "Oil palm plantation beneath a wide sky", default_image: "plantation-small.jpg" },
    { position: 2, tag: "Knowledge worth sharing", title: "A profession that keeps learning.", description: "Explore The Planter and ISP publications, connecting field experience with fresh perspectives from the plantation profession.", website_url: "https://isp.org.my/v4/library/", image_alt: "The Planter professional publication cover", default_image: "planter-cover.jpg" },
    { position: 3, tag: "Ideas grow in good company", title: "Make a connection. Share a new perspective.", description: "Discover workshops, field visits and conversations that bring the plantation community together.", website_url: "https://isp.org.my/v4/event/", image_alt: "Plantation professionals exchanging ideas", default_image: "member-events.jpg" }
  ].freeze

  has_one_attached :image
  scope :ordered, -> { order(:position) }
  validates :position, inclusion: { in: 1..3 }, uniqueness: true
  validates :tag, :title, :description, :website_url, :image_alt, :default_image, presence: true
  validates :tag, length: { maximum: 80 }
  validates :title, length: { maximum: 140 }
  validates :description, length: { maximum: 700 }
  validates :website_url, length: { maximum: 2048 }
  validates :image_alt, length: { maximum: 180 }
  validates :default_image, inclusion: { in: DEFAULT_IMAGES }
  validate :safe_https_destination
  validate :scanned_image
  before_validation :trim_text

  def self.safe_website_url?(value)
    value = value.to_s
    return false if value != value.strip || value.match?(/[[:cntrl:]\\]/) || value.match?(/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i)
    uri = URI.parse(value)
    uri.is_a?(URI::HTTPS) && uri.host.present? && uri.userinfo.nil? && uri.opaque.nil? && uri.port.between?(1, 65_535)
  rescue URI::InvalidURIError, ArgumentError
    false
  end

  private

  def scanned_image
    errors.add(:image, "has not passed the upload safety check") if image.attached? && !UploadScanner.approved_blob?(image.blob)
  end

  def trim_text
    %i[tag title description image_alt].each { |field| self[field] = self[field].to_s.strip }
  end

  def safe_https_destination
    errors.add(:website_url, "must be a complete HTTPS website address without login details or control characters") unless self.class.safe_website_url?(website_url)
  end
end

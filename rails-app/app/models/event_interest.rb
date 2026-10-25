class EventInterest < ApplicationRecord
  belongs_to :user
  belongs_to :event
  serialize :event_snapshot, coder: JSON
  before_validation :capture_published_version, on: :create
  validates :event_id, uniqueness: { scope: :user_id }
  validates :name, :email, presence: true
  validates :name, length: { maximum: 80 }
  validates :email, format: { with: URI::MailTo::EMAIL_REGEXP }, length: { maximum: 160 }
  validates :company, length: { maximum: 120 }
  validate :published_event

  private

  def capture_published_version
    return unless event&.published?
    self.event_snapshot = event.published_data.deep_dup
    self.event_revision = event.published_revision
  end

  def published_event
    errors.add(:event, "must be published") unless event&.published?
  end
end

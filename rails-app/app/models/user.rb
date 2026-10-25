class User < ApplicationRecord
  has_secure_password
  has_many :event_interests, dependent: :destroy
  has_many :interested_events, through: :event_interests, source: :event
  normalizes :email, with: ->(email) { email.strip.downcase }
  validates :name, :email, presence: true
  validates :email, uniqueness: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :role, inclusion: { in: %w[member admin] }
  validates :name, length: { maximum: 80 }
  validates :company, length: { maximum: 120 }
  validates :branch, length: { maximum: 100 }
  validates :phone, length: { maximum: 40 }

  def admin? = role == "admin"
  def member? = role == "member"
end

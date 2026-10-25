class ConsultationRequest < ApplicationRecord
  TOPICS = ["Plantation feasibility", "Operational due diligence", "Vendor management", "Cost and inventory optimisation", "Other enquiry"].freeze
  belongs_to :user
  attr_readonly :user_id, :request_key
  normalizes :subject, :message, with: ->(value) { value.strip }
  validates :category, inclusion: { in: TOPICS }
  validates :subject, presence: true, length: { maximum: 140 }
  validates :message, presence: true, length: { maximum: 5000 }
  validates :request_key, format: { with: /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/ }, uniqueness: { scope: :user_id }

  def reference = "ISP-Q#{id.to_s.rjust(6, '0')}"
end

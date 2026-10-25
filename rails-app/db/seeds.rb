raise "Sample accounts and events are disabled in production." if Rails.env.production?
DiscoverSlide::DEFAULTS.each do |attributes|
  DiscoverSlide.find_or_create_by!(position: attributes[:position]) { |slide| slide.assign_attributes(attributes) }
end
User.find_or_create_by!(email: "member@example.com") do |user|
  user.assign_attributes(name: "Alex Tan", role: "member", account_status: "active", company: "Greenfield Estate (sample)", branch: "Selangor / W. Persekutuan", phone: "+60 12 000 0000", password: "MemberDemo!2026")
end
User.find_or_create_by!(email: "admin@example.com") do |user|
  user.assign_attributes(name: "ISP Event Team", role: "admin", account_status: "active", company: "ISP (sample)", password: "AdminDemo!2026")
end
samples = [
  { slug: "plantation-leadership", title: "Plantation Leadership Exchange", format: "Workshop", summary: "Lead people. Strengthen decisions.", description: "A day of thoughtful exchange for plantation professionals. Work through a leadership case, learn from peers and take a practical action plan back to your estate.", audience: "Estate managers, assistant managers and emerging plantation leaders.", programme: "09:00 · Welcome and shared challenges\n09:30 · A leadership case in practice\n11:00 · Peer exchange and reflection\n12:30 · Lunch and close", date: "2026-11-19", starts_at: "09:00", ends_at: "13:00", venue: "ISP learning room · Petaling Jaya", venue_details: "Illustrative venue. This is a sample programme, not a scheduled ISP event.", admission: "paid", fee: "150.00", payment_method: "bank", bank_name: "Sample Bank", account_name: "ISP DEMO — DO NOT TRANSFER", account_number: "DEMO-0000-0000", receipt_email: "receipts@example.com", payment_notes: "Use fictional payment information in this preview. No payment is collected.", cover: "member-events.jpg" },
  { slug: "sustainable-field-visit", title: "Sustainable Plantation Field Visit", format: "Field visit", summary: "See the practice. Ask better questions.", description: "Explore field observation, responsible operations and the questions that help teams connect practice with evidence. Bring your curiosity and share what you notice.", audience: "Field teams, agronomy practitioners and sustainability colleagues.", programme: "08:30 · Briefing\n09:00 · Guided field observations\n11:00 · Shared reflection\n12:00 · Close", date: "2026-12-03", starts_at: "08:30", ends_at: "12:00", venue: "Johor · sample estate", venue_details: "Meeting point and travel details would be confirmed by the organiser.", admission: "free", cover: "academy-practice.jpg" },
  { slug: "data-for-estate-decisions", title: "Data for Better Estate Decisions", format: "Webinar", summary: "Turn field records into better questions.", description: "Look at a small illustrative dataset, question the quality of the evidence and discuss what a useful next step could look like. A practical conversation for working professionals.", audience: "Estate executives, operations managers and analysts.", programme: "14:00 · Data walkthrough\n14:40 · Interpretation exercise\n15:30 · Discussion and close", date: "2026-12-10", starts_at: "14:00", ends_at: "16:00", venue: "Online · joining details to follow", venue_details: "No live meeting link is configured for this sample programme.", admission: "free", cover: "academy-research.jpg" }
]
samples.each do |sample|
  slug = sample.delete(:slug)
  next if Event.exists?(slug: slug)
  data = sample.stringify_keys.merge("timezone" => "Asia/Kuala_Lumpur", "images" => [])
  Event.create!(slug: slug, draft_data: data, published_data: data.deep_dup, revision: 1, published_revision: 1, published_at: Time.current)
end

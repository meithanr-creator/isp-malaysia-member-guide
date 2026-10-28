module ApplicationHelper
  def discover_slide_image(slide)
    slide.image.attached? ? discover_image_path(id: slide.id, key: slide.image.blob.signed_id) : "/brand/#{slide.default_image}"
  end
  def discover_safe_website_url(slide)
    slide.website_url if DiscoverSlide.safe_website_url?(slide.website_url)
  end
  def isp_icon(name, **options)
    image_tag "/brand/#{name}.svg", { alt: "", class: "ui-icon", aria: { hidden: true } }.merge(options)
  end
  def event_date(data)
    Date.iso8601(data["date"].to_s).strftime("%-d %b %Y")
  rescue ArgumentError
    "Date to be confirmed"
  end
  def event_time(value)
    Time.strptime(value.to_s, "%H:%M").strftime("%-I:%M %P")
  rescue ArgumentError
    value
  end
  def event_timezone(data)
    { "Asia/Kuala_Lumpur" => "Malaysia time · MYT (UTC+8)", "Asia/Singapore" => "Singapore time · SGT (UTC+8)", "Asia/Jakarta" => "Jakarta time · WIB (UTC+7)", "UTC" => "UTC (UTC+0)" }.fetch(data["timezone"], data["timezone"])
  end
  def event_fee(data)
    data["admission"] == "free" ? "Free admission" : "RM #{number_with_precision(data['fee'], precision: 2)} per person"
  end
  def event_cover(data, event:)
    image = data.fetch("images", []).first
    image ? event_file_url(image, event: event) : "/brand/#{%w[member-events.jpg academy-practice.jpg academy-research.jpg].include?(data['cover']) ? data['cover'] : 'member-events.jpg'}"
  end
  def event_file_url(file, event:)
    event_file_path(event_id: event.slug, key: file["signed_id"])
  end
  def receipt_email_link(data)
    prefix = demo_mode? ? "Sample payment receipt" : "Payment receipt"
    subject = ERB::Util.url_encode("#{prefix} — #{data['title'].to_s.gsub(/[\r\n]/, ' ')}")
    body = ERB::Util.url_encode("Hello,\n\nEvent: #{data['title']}\nName: \nCompany: \n\nI will attach my #{demo_mode? ? 'sample payment receipt' : 'payment receipt'} before sending.\n")
    "mailto:#{ERB::Util.url_encode(data['receipt_email'])}?subject=#{subject}&body=#{body}"
  end
end


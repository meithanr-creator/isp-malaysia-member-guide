require "test_helper"

class EventTest < ActiveSupport::TestCase
  test "a complete free event can be previewed and published only once" do
    event = create_event

    assert_not event.published?
    event.prepare_preview!
    assert event.preview_current?
    assert_equal event.revision, event.preview_revision
    assert_equal event.clean_snapshot, event.preview_data

    event.publish!(expected_revision: event.revision)
    assert event.reload.published?
    assert_equal "Estate Leadership Exchange", event.published_title
    assert_nil event.preview_data
    assert_nil event.preview_revision
    assert_raises(Event::InvalidTransition) { event.publish!(expected_revision: event.revision) }
  end

  test "publish refuses a draft that has no preview" do
    event = create_event
    assert_raises(Event::InvalidTransition) { event.publish!(expected_revision: event.revision) }
    assert_not event.reload.published?
  end

  test "publish refuses a mismatched revision without changing the publication" do
    event = create_published_event
    original = event.published_data.deep_dup
    timestamp = event.published_at
    event.update!(draft_data: valid_event_data(title: "Revised title"), revision: 2)
    event.prepare_preview!

    assert_raises(Event::InvalidTransition) { event.publish!(expected_revision: 1) }
    event.reload
    assert_equal original, event.published_data
    assert_equal timestamp, event.published_at
    assert event.preview_current?
  end

  test "a preview for an older revision cannot publish" do
    event = create_event
    event.prepare_preview!
    event.update!(draft_data: valid_event_data(title: "Draft edited after preview"), revision: 2)

    assert_not event.preview_current?
    assert_raises(Event::InvalidTransition) { event.publish!(expected_revision: 2) }
    assert_not event.reload.published?
  end

  test "published data is isolated from later draft and preview edits" do
    event = create_published_event
    published = event.published_data.deep_dup
    event.update!(draft_data: valid_event_data(title: "Unpublished replacement"), revision: 2)
    event.prepare_preview!

    assert_equal published, event.reload.published_data
    assert_equal "Unpublished replacement", event.preview_data.fetch("title")
    assert_equal "Estate Leadership Exchange", event.published_title
  end

  test "an incomplete draft can be saved but cannot be previewed" do
    event = create_event(title: "", summary: "", description: "", date: "", starts_at: "", ends_at: "", venue: "")
    assert event.persisted?
    assert_raises(Event::InvalidTransition) { event.prepare_preview! }
    assert_nil event.reload.preview_data
  end

  {
    "invalid date" => { date: "2027-02-30" },
    "malformed start" => { starts_at: "24:01" },
    "malformed end" => { ends_at: "12:99" },
    "end equals start" => { ends_at: "09:00" },
    "end before start" => { ends_at: "08:00" },
    "unsupported format" => { format: "Injected format" },
    "unsupported timezone" => { timezone: "Mars/Olympus" },
    "invalid admission" => { admission: "vip" }
  }.each do |label, values|
    test "preview rejects #{label}" do
      event = create_event(values)
      assert_raises(Event::InvalidTransition) { event.prepare_preview! }
      assert_not event.reload.preview_current?
      assert_not event.published?
    end
  end

  test "text field length bounds also apply to saved drafts" do
    event = Event.new(draft_data: valid_event_data(title: "x" * 111))
    assert_not event.valid?
    assert event.errors[:title].present?
  end

  test "free publication discards all hidden payment instructions" do
    event = create_event(fee: "250", payment_method: "bank", bank_name: "Hidden Bank",
      account_name: "Hidden Account", account_number: "123", receipt_email: "hidden@example.test", payment_notes: "Hidden notes")
    event.prepare_preview!
    event.publish!(expected_revision: event.revision)

    %w[fee payment_method bank_name account_name account_number receipt_email payment_notes].each do |key|
      assert_equal "", event.reload.published_data.fetch(key), "free events must clear #{key}"
    end
  end

  test "paid bank event needs a valid fee account and receipt email" do
    data = { admission: "paid", fee: "125.50", payment_method: "bank", bank_name: "Sample Bank",
      account_name: "Sample Organiser", account_number: "DEMO123", receipt_email: "receipts@example.test" }
    event = create_event(data)
    event.prepare_preview!
    assert event.preview_current?

    ["0", "-1", "100000.01", "not-a-number", "NaN", "Infinity"].each do |fee|
      candidate = create_event(data.merge(fee: fee))
      assert_raises(Event::InvalidTransition, "invalid fee #{fee}") { candidate.prepare_preview! }
    end
    %i[bank_name account_name account_number receipt_email].each do |field|
      candidate = create_event(data.merge(field => ""))
      assert_raises(Event::InvalidTransition, "missing #{field}") { candidate.prepare_preview! }
    end
  end

  test "paid organiser arrangement strips stale bank details" do
    event = create_event(admission: "paid", fee: "20", payment_method: "organiser",
      bank_name: "Stale Bank", account_name: "Stale Name", account_number: "123",
      receipt_email: "receipts@example.test")
    event.prepare_preview!
    %w[bank_name account_name account_number].each { |field| assert_equal "", event.preview_data[field] }
    assert_equal "20", event.preview_data.fetch("fee")
  end
end

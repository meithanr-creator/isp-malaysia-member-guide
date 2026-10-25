require "test_helper"

class EventInterestTest < ActiveSupport::TestCase
  test "only a published event can receive interest" do
    interest = EventInterest.new(user: create_member, event: create_event, name: "Alex Sample", email: "alex@example.test")
    assert_not interest.valid?
    assert interest.errors[:event].present?
  end

  test "a member can record interest once per published event" do
    member = create_member
    event = create_published_event
    attributes = { user: member, event: event, name: member.name, email: member.email, company: member.company }
    EventInterest.create!(attributes)
    duplicate = EventInterest.new(attributes)

    assert_not duplicate.valid?
    assert duplicate.errors[:event_id].present?
    assert_equal 1, EventInterest.where(user: member, event: event).count
  end

  test "the database independently prevents duplicate interest" do
    member = create_member
    event = create_published_event
    attributes = { user_id: member.id, event_id: event.id, name: member.name, email: member.email, created_at: Time.current, updated_at: Time.current }
    EventInterest.insert_all!([attributes])
    assert_raises(ActiveRecord::RecordNotUnique) { EventInterest.insert_all!([attributes]) }
  end

  test "interest needs valid bounded contact fields" do
    interest = EventInterest.new(user: create_member, event: create_published_event, name: "", email: "invalid", company: "x" * 121)
    assert_not interest.valid?
    %i[name email company].each { |field| assert interest.errors[field].present?, "missing validation for #{field}" }
  end

  test "interest retains the published version even when a newer private draft exists" do
    event = create_published_event
    published_revision = event.revision
    public_copy = event.published_data.deep_dup
    assert EventDraftUpdater.new(event).call(attributes: { "title" => "Private future revision" }, expected_lock_version: event.lock_version)
    member = create_member
    interest = EventInterest.create!(user: member, event: event, name: member.name, email: member.email)

    assert_equal public_copy, interest.reload.event_snapshot
    assert_equal published_revision, interest.event_revision
    assert_not_equal event.reload.revision, interest.event_revision
    assert EventDraftUpdater.new(event).call(attributes: { "title" => "Further private work" }, expected_lock_version: event.lock_version)
    assert_equal public_copy, interest.reload.event_snapshot
  end
end

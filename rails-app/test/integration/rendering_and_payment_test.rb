require "test_helper"

class RenderingAndPaymentTest < ActionDispatch::IntegrationTest
  test "public copy escapes administrator supplied HTML" do
    title = '<script>alert("sample")</script>'
    event = create_published_event(title: title, description: '<img src=x onerror="alert(1)">', venue: '<b>Sample hall</b>')
    get event_path(event)
    assert_response :success
    assert_includes response.body, "&lt;script&gt;"
    assert_select "script", text: /alert\(/, count: 0
    assert_select "img[onerror]", count: 0
    assert_includes response.body, "&lt;b&gt;Sample hall&lt;/b&gt;"
  end

  test "paid event prepares email draft only and sends no receipt" do
    event = create_published_event(admission: "paid", fee: "75.50", payment_method: "bank", bank_name: "Sample Bank",
      account_name: "Sample Organiser", account_number: "DEMO123", receipt_email: "receipts@example.test", payment_notes: "Use sample payment details.")
    public_copy = event.published_data.deep_dup
    assert_no_difference("ActionMailer::Base.deliveries.count") { get event_path(event) }
    assert_response :success
    assert_select "a[href^='mailto:']", minimum: 1
    assert_select "form[action*='receipt']", count: 0
    assert_equal public_copy, event.reload.published_data
    assert_equal 0, event.event_interests.count
  end

  test "free public event never exposes hidden payment instructions" do
    event = create_published_event(admission: "free", fee: "99", bank_name: "HIDDEN-BANK",
      account_name: "HIDDEN-ACCOUNT", account_number: "HIDDEN-NUMBER", receipt_email: "hidden@example.test", payment_notes: "HIDDEN-NOTES")
    get event_path(event)
    assert_response :success
    %w[HIDDEN-BANK HIDDEN-ACCOUNT HIDDEN-NUMBER hidden@example.test HIDDEN-NOTES].each { |value| assert_not_includes response.body, value }
    assert_select "a[href*='hidden']", count: 0
  end
end

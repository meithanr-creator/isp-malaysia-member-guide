require "test_helper"

class MembershipAndConsultationTest < ActionDispatch::IntegrationTest
  setup do
    @member = create_member(name: "Alex Registered", company: "Registered Estate", branch: "Registered Branch", phone: "0191234567")
    @admin = create_member(role: "admin")
    @other = create_member
  end

  test "membership is member-only and shows stored profile without CPD or invented account details" do
    get member_membership_path
    assert_redirected_to login_path
    sign_in
    get member_membership_path
    assert_response :success
    assert_includes response.headers["Cache-Control"], "no-store"
    assert_select "main .page" do |pages|
      content = pages.map(&:text).join(" ")
      [@member.name, @member.email, @member.company, @member.branch, @member.phone].each { |value| assert_includes content, value }
      assert_no_match(/\bCPD\b|DEMO-\d|demo|sample|prototype/i, content)
    end
    sign_in(@admin)
    get member_membership_path
    assert_response :forbidden
  end

  test "native membership publications and consultation menu links have no CPD or demo wording" do
    get events_path
    assert_select "nav.menu a[href=?]", member_membership_path do |links|
      assert_equal 1, links.size
      assert_no_match(/CPD|demo/i, links.first.text)
    end
    assert_select "nav.menu a[href=?]", member_publications_path do |links|
      assert_equal 1, links.size
      assert_no_match(/demo/i, links.first.text)
    end
    assert_select "nav.menu a[href=?]", member_consultation_requests_path do |links|
      assert_equal 1, links.size
      assert_no_match(/demo/i, links.first.text)
    end
    %w[membership publications consultation].each { |area| assert_select "nav.menu a[href*='review=1##{area}']", count: 0 }
  end

  test "visitor is returned to the requested consultation page after login" do
    get new_member_consultation_request_path
    assert_redirected_to login_path
    sign_in
    assert_redirected_to new_member_consultation_request_path
    assert_no_difference("ConsultationRequest.count") do
      delete session_path
      post member_consultation_requests_path, params: { consultation_request: consultation_attributes }
    end
    assert_redirected_to login_path
  end

  test "submitted consultation persists under the current member and ignores spoofed ownership" do
    sign_in
    data = consultation_attributes(user_id: @other.id, id: 999999, status: "closed")
    assert_difference("ConsultationRequest.count", 1) do
      assert_no_difference("ActionMailer::Base.deliveries.count") do
        post member_consultation_requests_path, params: { consultation_request: data }
      end
    end
    query = @member.consultation_requests.find_by!(request_key: data[:request_key])
    assert_redirected_to member_consultation_request_path(query)
    assert_equal @member.id, query.user_id
    assert_equal data[:subject], query.reload.subject
    assert_equal data[:message], query.message
    get member_consultation_request_path(query)
    assert_response :success
    assert_includes response.body, query.subject
    assert_includes response.body, query.message
  end

  test "retry of the same key returns the original query without changing its content" do
    sign_in
    data = consultation_attributes
    post member_consultation_requests_path, params: { consultation_request: data }
    query = @member.consultation_requests.find_by!(request_key: data[:request_key])
    assert_no_difference("ConsultationRequest.count") do
      post member_consultation_requests_path, params: { consultation_request: data.merge(message: "Retry must not overwrite the original") }
    end
    assert_redirected_to member_consultation_request_path(query)
    assert_equal data[:message], query.reload.message
  end

  test "member history and direct lookup cannot expose another member query" do
    mine = create_consultation(user: @member, subject: "My own consultation")
    private_query = create_consultation(user: @other, subject: "Another member private consultation")
    sign_in
    get member_consultation_requests_path
    assert_response :success
    assert_includes response.body, mine.subject
    assert_not_includes response.body, private_query.subject
    get member_consultation_request_path(private_query)
    assert_response :not_found
  end

  test "invalid consultation fields cannot create a saved query" do
    sign_in
    [{ subject: "" }, { message: "" }, { category: "Injected category" }, { subject: "x" * 141 }, { message: "x" * 5001 }, { request_key: "not-a-uuid" }].each do |values|
      assert_no_difference("ConsultationRequest.count") do
        post member_consultation_requests_path, params: { consultation_request: consultation_attributes(values) }
      end
      assert_response :unprocessable_entity
    end
  end

  test "tokenless consultation submission is refused when CSRF protection is enabled" do
    sign_in
    previous = ApplicationController.allow_forgery_protection
    ApplicationController.allow_forgery_protection = true
    assert_no_difference("ConsultationRequest.count") do
      post member_consultation_requests_path, params: { consultation_request: consultation_attributes }
    end
    assert_response :unprocessable_entity
  ensure
    ApplicationController.allow_forgery_protection = previous
  end

  test "admin inbox is private read-only and administrators cannot submit member queries" do
    query = create_consultation(user: @member)
    get admin_consultation_requests_path
    assert_redirected_to login_path
    sign_in
    get admin_consultation_requests_path
    assert_response :forbidden
    sign_in(@admin)
    get admin_consultation_requests_path
    assert_response :success
    assert_includes response.body, query.subject
    get admin_consultation_request_path(query)
    assert_response :success
    assert_includes response.body, @member.name
    assert_includes response.body, query.message
    assert_no_changes -> { query.reload.attributes } do
      patch admin_consultation_request_path(query), params: { consultation_request: { message: "Unauthorized edit" } }
      assert_response :not_found
      delete admin_consultation_request_path(query)
      assert_response :not_found
    end
    assert_no_difference("ConsultationRequest.count") do
      post member_consultation_requests_path, params: { consultation_request: consultation_attributes }
      assert_response :forbidden
    end
  end

  test "query HTML is escaped in member history and admin inbox" do
    query = create_consultation(user: @member, subject: '<script>alert("query")</script>', message: '<img src=x onerror="alert(1)">')
    sign_in
    get member_consultation_request_path(query)
    assert_includes response.body, "&lt;script&gt;"
    assert_select "script", text: /alert\(/, count: 0
    assert_select "img[onerror]", count: 0
    sign_in(@admin)
    get admin_consultation_request_path(query)
    assert_includes response.body, "&lt;script&gt;"
    assert_select "script", text: /alert\(/, count: 0
    assert_select "img[onerror]", count: 0
  end

  private

  def sign_in(user = @member)
    post session_path, params: { email: user.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
  end
end

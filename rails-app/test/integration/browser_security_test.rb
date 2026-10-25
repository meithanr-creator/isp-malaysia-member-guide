require "test_helper"

class BrowserSecurityTest < ActionDispatch::IntegrationTest
  test "pages enforce same-origin scripts and nonce the import map" do
    get root_path
    assert_response :success
    policy = response.headers.fetch("Content-Security-Policy")
    assert_includes policy, "object-src 'none'"
    assert_includes policy, "frame-ancestors 'none'"
    assert_includes policy, "form-action 'self'"
    assert_includes policy, "worker-src 'self'"
    assert_not_includes policy, "'unsafe-inline'"
    assert_not_includes policy, "'unsafe-eval'"
    nonce = policy.match(/script-src[^;]*'nonce-([^']+)'/)&.captures&.first
    assert nonce.present?, "Import maps need a request-specific script nonce"
    assert_select "script[type=importmap][nonce=?]", nonce
    get root_path
    next_nonce = response.headers.fetch("Content-Security-Policy").match(/script-src[^;]*'nonce-([^']+)'/)&.captures&.first
    assert_not_equal nonce, next_nonce
  end

  test "home-screen manifest uses the ISP identity and app root" do
    get pwa_manifest_path
    assert_response :success
    assert_equal "application/json", response.media_type
    manifest = JSON.parse(response.body)
    assert_equal "ISP", manifest.fetch("short_name")
    assert_equal "/", manifest.fetch("start_url")
    assert_equal "standalone", manifest.fetch("display")
    assert_equal ["192x192", "512x512"], manifest.fetch("icons").map { |icon| icon.fetch("sizes") }
    manifest.fetch("icons").each do |icon|
      assert_match %r{\A/brand/isp-\d+\.png\z}, icon.fetch("src")
    end
  end

  test "service worker response is public code without member data" do
    member = create_member
    post session_path, params: { email: member.email, password: "test-password-2026" }, headers: { "REMOTE_ADDR" => "2001:db8:42::1" }
    assert_redirected_to member_dashboard_path
    get pwa_service_worker_path
    assert_response :success
    assert_includes %w[text/javascript application/javascript], response.media_type
    assert_not_includes response.body, member.email
    assert_not_includes response.body, member.name
    assert_not_includes response.body, "authentication_token"
    assert_not_includes response.body, "caches.open"
    assert_not_includes response.body, "cache.put"
  end
end

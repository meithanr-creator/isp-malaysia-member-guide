require "test_helper"

class UploadDiagnosticIntegrationTest < ActionDispatch::IntegrationTest
  TRACE = "12345678-1234-1234-1234-123456789abc"
  teardown { close_discover_uploads }

  test "all upload controllers preserve safe rejected responses and correlate operation metadata" do
    admin = create_member(role: "admin")
    post session_path, params: { email: admin.email, password: "test-password-2026" },
      headers: { "REMOTE_ADDR" => "2001:db8:#{SecureRandom.hex(2)}:#{SecureRandom.hex(2)}::1" }
    assert_response :redirect
    event, publication, slide = create_event, create_publication, create_discover_slide
    cases = [
      [admin_event_path(event), :event, event, { images: [discover_upload], lock_version: event.lock_version }],
      [admin_publication_path(publication), :publication, publication,
        { pdf: discover_upload(content: "%PDF-1.7 safe", filename: "safe.pdf", type: "application/pdf"), lock_version: publication.lock_version }],
      [admin_discover_slide_path(slide), :discover_slide, slide, { image: discover_upload, lock_version: slide.lock_version }]
    ]
    cases.each do |route, param, record, fields|
      before = record.attributes.deep_dup
      ActiveStorage::Blob.service.stub(:upload, ->(*) { raise IOError, "synthetic-secret-must-not-leak" }) do
        patch route, params: { param => fields }, headers: { "X-ISP-Trace" => TRACE }
      end
      assert_response :unprocessable_entity
      assert_equal TRACE, response.headers["x-isp-trace"]
      assert_match RequestDiagnosticMetadata::UUID, response.headers["x-isp-diagnostic-operation"]
      assert_equal "UploadOperation::StorageFailure", response.headers["x-isp-diagnostic-exception"]
      assert_not_includes response.body, "synthetic-secret-must-not-leak"
      assert_equal before, record.reload.attributes
      operation = response.headers["x-isp-diagnostic-operation"]
      blobs = ActiveStorage::Blob.where("key LIKE ?", "managed-uploads/#{operation}/%")
      assert_equal 1, blobs.count
      assert_equal "tombstone", blobs.sole.metadata.fetch(UploadOperation::LEDGER).fetch("state")
    end
  end
end

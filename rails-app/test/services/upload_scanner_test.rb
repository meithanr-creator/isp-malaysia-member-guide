require "minitest/autorun"
require "stringio"
require_relative "../../app/services/upload_scanner"

class UploadScannerTest < Minitest::Test
  NOW = Time.utc(2026, 10, 25, 8)
  VERSION = "ClamAV 1.4.6/28000/#{NOW.rfc2822}\0"
  class ProtocolSocket
    attr_reader :written
    def initialize(response)
      @response, @written = response, +"".b
    end
    def write(bytes) = @written << bytes
    def gets(separator, limit) = @response
  end
  class Scanner < UploadScanner
    attr_reader :sockets
    def initialize(*responses)
      super(env: {}, clock: -> { NOW })
      @responses, @sockets = responses, []
    end
    private
    def exchange
      response = @responses.shift
      raise response if response.is_a?(Exception)
      socket = ProtocolSocket.new(response)
      @sockets << socket
      yield socket
    end
  end

  def test_streams_exact_bytes_and_records_a_clean_verdict
    file = StringIO.new("sample PDF bytes\0with binary")
    scanner = Scanner.new(VERSION, "stream: OK\0")
    assert_nil scanner.scan(file)
    metadata = UploadScanner.metadata(file)
    assert_equal "clean", metadata["scan_status"]
    assert_equal "ClamAV", metadata["scan_engine"]
    assert_equal Digest::SHA256.hexdigest(file.string), metadata["scan_sha256"]
    assert_equal NOW.iso8601, metadata["scanned_at"]
    expected = "zINSTREAM\0" + [ file.size ].pack("N") + file.string + [ 0 ].pack("N")
    assert_equal expected, scanner.sockets.last.written
    assert_equal 0, file.pos
  end

  def test_detected_content_is_rejected_without_clean_metadata
    file = StringIO.new("harmless test fixture")
    error = Scanner.new(VERSION, "stream: Eicar-Test-Signature FOUND\0").scan(file)
    assert_match(/did not pass/, error)
    assert_empty UploadScanner.metadata(file)
  end

  def test_scan_error_and_unknown_or_unterminated_responses_fail_closed
    [ "stream: scan failed ERROR\0", "UNKNOWN COMMAND\0", "stream: OK" ].each do |response|
      file = StringIO.new("bytes")
      assert_equal UploadScanner::UNAVAILABLE_MESSAGE, Scanner.new(VERSION, response).scan(file)
      assert_empty UploadScanner.metadata(file)
    end
  end

  def test_stale_missing_or_future_signature_dates_fail_closed
    [ "ClamAV 1.4.6/1/#{(NOW - 49 * 3600).rfc2822}\0", "ClamAV 1.4.6/1/#{(NOW + 2 * 3600).rfc2822}\0", "ClamAV 1.4.6\0" ].each do |response|
      scanner = Scanner.new(response)
      assert_equal UploadScanner::UNAVAILABLE_MESSAGE, scanner.scan(StringIO.new("bytes"))
      assert_equal 1, scanner.sockets.length
    end
  end

  def test_timeout_and_daemon_outage_fail_closed
    [ Timeout::Error.new, Errno::ECONNREFUSED.new, IOError.new ].each do |failure|
      assert_equal UploadScanner::UNAVAILABLE_MESSAGE, Scanner.new(failure).scan(StringIO.new("bytes"))
    end
  end

  def test_oversize_does_not_contact_daemon
    file = StringIO.new("bytes")
    def file.size = UploadScanner::MAX_BYTES + 1
    scanner = Scanner.new
    assert_match(/too large/, scanner.scan(file))
    assert_empty scanner.sockets
  end

  def test_readiness_checks_signature_age_but_does_not_claim_detection
    assert_nil Scanner.new(VERSION).readiness_error
    assert_equal UploadScanner::UNAVAILABLE_MESSAGE, Scanner.new("ClamAV 1.4.6/1/#{(NOW - 49 * 3600).rfc2822}\0").readiness_error
  end
  def test_production_denies_unscanned_or_changed_blob_bytes
    blob_class = Struct.new(:metadata, :content) do
      def download = content
    end
    assert_nil UploadScanner.download(blob_class.new({}, "bytes"), production: true)
    file = StringIO.new("trusted clean bytes")
    assert_nil Scanner.new(VERSION, "stream: OK\0").scan(file)
    blob = blob_class.new(UploadScanner.metadata(file), file.string)
    assert_equal file.string, UploadScanner.download(blob, production: true)
    blob.content = "tampered object"
    assert_nil UploadScanner.download(blob, production: true)
    assert_equal "tampered object", UploadScanner.download(blob, production: false)
  end
end

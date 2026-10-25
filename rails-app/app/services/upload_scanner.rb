require "socket"
require "timeout"
require "time"
require "digest"

# The request tempfile is quarantine: only a clean scan can reach object storage.
# clamd must be on the operator's private network, never a public unauthenticated port.
class UploadScanner
  class Unavailable < StandardError; end
  MAX_BYTES = 25 * 1024 * 1024
  CHUNK_BYTES = 64 * 1024
  TIMEOUT_SECONDS = 15
  MAX_SIGNATURE_AGE = 48 * 60 * 60
  # Latest supported patch versions verified against ClamAV support matrix.
  SUPPORTED_ENGINES = %w[1.4.6 1.5.4].freeze
  UNAVAILABLE_MESSAGE = "The upload safety check is unavailable. Please try again later."

  def self.required?
    Rails.env.production? || ENV["ISP_SCAN_UPLOADS"] == "true"
  end

  def self.error(file)
    return unless required?
    new.scan(file)
  end

  def self.metadata(file)
    file.instance_variable_get(:@isp_upload_scan) || {}
  end

  def self.approved_blob?(blob, production: Rails.env.production?)
    return true unless production
    metadata = blob.metadata
    return false unless metadata["scan_status"] == "clean" && metadata["scan_engine"] == "ClamAV" && metadata["scan_sha256"].to_s.match?(/\A[0-9a-f]{64}\z/)
    return false unless metadata["scan_signature_version"].to_s.match?(/\AClamAV (?:#{SUPPORTED_ENGINES.map { |version| Regexp.escape(version) }.join('|')})\/\d+\z/)
    Time.iso8601(metadata.fetch("scanned_at", ""))
    true
  rescue ArgumentError
    false
  end

  def self.download(blob, production: Rails.env.production?)
    return unless approved_blob?(blob, production: production)
    bytes = blob.download
    return bytes unless production
    bytes if Digest::SHA256.hexdigest(bytes) == blob.metadata["scan_sha256"]
  end

  def initialize(env: ENV, clock: -> { Time.now.utc })
    @env, @clock = env, clock
  end

  def readiness_error
    signature_version
    nil
  rescue Unavailable, ArgumentError, KeyError, SystemCallError, IOError, Timeout::Error
    UNAVAILABLE_MESSAGE
  end

  def scan(file)
    file.remove_instance_variable(:@isp_upload_scan) if file.instance_variable_defined?(:@isp_upload_scan)
    return "The upload is too large to scan safely." if file.size > MAX_BYTES
    version = signature_version
    digest = Digest::SHA256.new
    result = exchange do |socket|
      socket.write("zINSTREAM\0")
      bytes = 0
      file.rewind
      while (chunk = file.read(CHUNK_BYTES))
        bytes += chunk.bytesize
        raise Unavailable if bytes > MAX_BYTES
        digest.update(chunk)
        socket.write([ chunk.bytesize ].pack("N"))
        socket.write(chunk)
      end
      socket.write([ 0 ].pack("N"))
      read_response(socket)
    end
    return "This file did not pass the upload safety check. Choose another file." if result.end_with?(" FOUND")
    raise Unavailable unless result == "stream: OK"
    file.instance_variable_set(:@isp_upload_scan, {
      "scan_status" => "clean", "scan_engine" => "ClamAV",
      "scan_signature_version" => version, "scanned_at" => @clock.call.iso8601,
      "scan_sha256" => digest.hexdigest
    })
    nil
  rescue Unavailable, ArgumentError, KeyError, SystemCallError, IOError, Timeout::Error
    UNAVAILABLE_MESSAGE
  ensure
    file.rewind if file.respond_to?(:rewind)
  end

  private

  def signature_version
    response = exchange do |socket|
      socket.write("zVERSION\0")
      read_response(socket)
    end
    engine, revision, date = response.split("/", 3)
    raise Unavailable unless SUPPORTED_ENGINES.any? { |version| engine == "ClamAV #{version}" } && revision.to_s.match?(/\A\d+\z/) && date
    age = @clock.call - Time.parse(date)
    raise Unavailable unless age.between?(-3600, MAX_SIGNATURE_AGE)
    "#{engine}/#{revision}"
  end

  def exchange
    socket = nil
    Timeout.timeout(TIMEOUT_SECONDS) do
      host = @env.fetch("CLAMD_HOST")
      raise Unavailable if host.strip.empty?
      socket = Socket.tcp(host, Integer(@env.fetch("CLAMD_PORT", "3310")), connect_timeout: 3)
      yield socket
    end
  ensure
    socket&.close
  end

  def read_response(socket)
    response = socket.gets("\0", 4096)
    raise Unavailable unless response&.end_with?("\0")
    response.delete_suffix("\0").strip
  end
end

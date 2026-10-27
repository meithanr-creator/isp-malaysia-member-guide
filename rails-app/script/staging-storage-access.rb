# Direct HEAD/LIST/GET observations only. No object PUT/DELETE or public-access mutation.
require "aws-sdk-s3"
require "json"
require "net/http"
require "openssl"
require "digest"
require "time"
require "timeout"

module StagingStorageAccess
  LEASE = "rails-staging-3"
  ACCOUNT = "a9720867333b64a4f8ee70cdfd673eb9"
  BUCKET = "isp-staging-private"
  ENDPOINT = "https://"+ACCOUNT+".r2.cloudflarestorage.com"
  CA = "D:/Projects/isp-rails-tools/ruby34-devkit/lib/ruby/3.4.0/etc/ssl/cert.pem"
  BODY_BOUND = 262_144
  LIST_BODY_BOUND = 4 * 1024 * 1024
  AUTH_CODES = %w[InvalidArgument InvalidRequest AuthorizationHeaderMalformed SignatureDoesNotMatch].freeze
  class MetadataPermission < StandardError; end
  class MetadataIncomplete < StandardError; end
  class PublicAccessEnabled < StandardError; end
  class AnonymousNotDenied < StandardError; end

  def self.get(uri, headers = {})
    http = Net::HTTP.new(uri.host, uri.port, nil)
    http.use_ssl = true
    http.verify_mode = OpenSSL::SSL::VERIFY_PEER
    http.verify_hostname = true
    http.ca_file = CA
    http.min_version = OpenSSL::SSL::TLS1_2_VERSION
    http.open_timeout = 3
    http.read_timeout = 5
    request = Net::HTTP::Get.new(uri.request_uri, {"Accept-Encoding" => "identity", "User-Agent" => "ISP-staging-readonly-access/1"}.merge(headers))
    status = nil
    body = String.new(encoding: Encoding::BINARY)
    http.start do |connection|
      connection.request(request) do |response|
        status = response.code.to_i
        raise MetadataPermission if uri.host == "api.cloudflare.com" && [401,403].include?(status)
        length = response["content-length"]
        raise MetadataIncomplete if length && (!length.match?(/\A\d+\z/) || length.to_i > BODY_BOUND)
        response.read_body do |chunk|
          raise MetadataIncomplete if body.bytesize + chunk.bytesize > BODY_BOUND
          body << chunk
        end
      end
    end
    {status: status, body: body, sha256: Digest::SHA256.hexdigest(body)}
  end

  def self.metadata(response)
    raise MetadataPermission if [401,403].include?(response[:status])
    raise MetadataIncomplete unless response[:status] == 200
    value = JSON.parse(response[:body])
    raise MetadataIncomplete unless value.is_a?(Hash) && value["success"] == true && value["errors"] == [] && value["messages"].is_a?(Array) && value["result"].is_a?(Hash)
    # These endpoints return a complete object/list with no pagination contract.
    forbidden = %w[result_info cursor next_cursor continuation_token next_continuation_token has_more truncated is_truncated next]
    raise MetadataIncomplete if forbidden.any? { |key| value.key?(key) || value["result"].key?(key) }
    value["result"]
  end

  def self.bounded_s3(client,operation,params,limit)
    request = client.build_request(operation,params)
    received = 0
    request.context.http_response.on_headers do |_status,headers|
      length = headers["content-length"]
      raise MetadataIncomplete if length && (!length.match?(/\A\d+\z/) || length.to_i > limit)
    end
    request.context.http_response.on_data do |chunk|
      received += chunk.bytesize
      raise MetadataIncomplete if received > limit
    end
    request.send_request
  end

  def self.anonymous_denial(response)
    code = response[:body][/<Code>([A-Za-z]+)<\/Code>/,1]
    authentication = response[:body].match?(/authentication|authorization|signature/i)
    denied = [401,403].include?(response[:status]) || (response[:status] == 400 && authentication && AUTH_CODES.include?(code))
    [denied,code]
  end

  def self.private_routes!(managed,custom)
    raise MetadataIncomplete unless managed.is_a?(Hash) && custom.is_a?(Hash) && managed.key?("enabled") && [true,false].include?(managed["enabled"])
    raise PublicAccessEnabled unless managed["enabled"] == false
    domains = custom["domains"]
    raise MetadataIncomplete unless domains.is_a?(Array) && domains.length <= 1000 && domains.all? { |domain| domain.is_a?(Hash) && domain["domain"].is_a?(String) && !domain["domain"].empty? && domain["domain"].length <= 253 && [true,false].include?(domain["enabled"]) }
    raise PublicAccessEnabled unless domains.all? { |domain| domain["enabled"] == false }
    true
  end

  def self.collect
    observed_at = nil
    begin
      raise "Fixed lease required" unless ARGV.empty? && ENV["ISP_STAGING_LEASE"] == LEASE && ENV["SSL_CERT_FILE"] == CA
      raise "Fixed CA required" if File.lstat(CA).symlink? || File.realpath(CA).tr(92.chr, "/").downcase != CA.downcase
      key = ENV.fetch("AWS_ACCESS_KEY_ID")
      secret = ENV.fetch("AWS_SECRET_ACCESS_KEY")
      token = ENV.fetch("ISP_CF_METADATA_TOKEN")
      raise "Credential shape refused" unless key.match?(/\A[A-Za-z0-9_+\/=-]{16,256}\z/) && secret.match?(/\A[A-Za-z0-9_+\/=-]{32,256}\z/) && token.match?(/\A[A-Za-z0-9._~+\/-]{32,4096}={0,2}\z/)
      receipt = nil
      Timeout.timeout(32) do
        client = Aws::S3::Client.new(region: "auto", endpoint: ENDPOINT, force_path_style: true, credentials: Aws::Credentials.new(key,secret), retry_limit: 0, follow_redirects: false, http_proxy: nil, http_wire_trace: false, http_open_timeout: 3, http_read_timeout: 5, ssl_verify_peer: true, ssl_ca_bundle: CA)
        observed_at = Time.now.utc.iso8601(3)
        head = bounded_s3(client,:head_bucket,{bucket: BUCKET},BODY_BOUND)
        listing = bounded_s3(client,:list_objects_v2,{bucket: BUCKET,max_keys: 1000},LIST_BODY_BOUND)
        head_status = head.context.http_response.status_code
        list_status = listing.context.http_response.status_code
        raise "Authenticated access incomplete" unless head_status == 200 && list_status == 200 && listing.is_truncated == false && listing.next_continuation_token.to_s.empty? && listing.contents.is_a?(Array) && listing.contents.length <= 1000 && listing.key_count == listing.contents.length
        anonymous = get(URI(ENDPOINT+"/"+BUCKET+"?list-type=2&max-keys=1"))
        denied, error_code = anonymous_denial(anonymous)
        raise AnonymousNotDenied unless denied
        base = "https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/r2/buckets/"+BUCKET+"/domains/"
        authorization = {"Authorization" => "Bearer "+token}
        managed_response = get(URI(base+"managed"),authorization)
        managed = metadata(managed_response)
        custom_response = get(URI(base+"custom"),authorization)
        custom = metadata(custom_response)
        private_routes!(managed,custom)
        receipt = {version: 1, kind: "r2-readonly-access", lease_id: LEASE, observed_at: observed_at, status: "PASS", read_only: true, tls_verified: true, authenticated_head_status: head_status, authenticated_list_status: list_status, anonymous_denied: true, anonymous_status: anonymous[:status], truncated: false, public_access_verified: true, private: true, access_verified: true, bucket: BUCKET, endpoint: ENDPOINT, managed_public_enabled: false, custom_domains_disabled: true, custom_domains_complete: true, cf_managed_status: managed_response[:status], cf_custom_status: custom_response[:status], cf_managed_sha256: managed_response[:sha256], cf_custom_sha256: custom_response[:sha256], object_count: listing.contents.length}
        receipt[:authentication_error_code] = error_code if anonymous[:status] == 400
      end
      puts JSON.generate(receipt)
      true
    rescue StandardError => error
      code = case error
      when MetadataPermission then "r2_metadata_permission_required"
      when MetadataIncomplete then "r2_metadata_incomplete"
      when PublicAccessEnabled then "r2_public_access_enabled"
      when AnonymousNotDenied then "r2_anonymous_access_not_denied"
      else "r2_access_failed"
      end
      puts JSON.generate(version: 1, kind: "r2-readonly-access", lease_id: LEASE, observed_at: observed_at || Time.now.utc.iso8601(3), status: "BLOCKED", read_only: true, code: code)
      false
    end
  end
end
exit(StagingStorageAccess.collect ? 0 : 1) if $PROGRAM_NAME == __FILE__

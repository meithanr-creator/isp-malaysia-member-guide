# Direct HEAD/LIST/GET observations only. No object PUT/DELETE or public-access mutation.
require "aws-sdk-s3"
require "json"
require "net/http"
require "openssl"
require "digest"
require "time"
require "timeout"
require "socket"
require "ipaddr"

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


  HOSTS = [(ACCOUNT+".r2.cloudflarestorage.com").freeze, "api.cloudflare.com".freeze].freeze
  NONPUBLIC_V4 = %w[0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4].map { |cidr| IPAddr.new(cidr).freeze }.freeze
  class AddressResolutionFailure < StandardError; end
  class FixedTransportRefused < StandardError; end
  class AuthenticatedReadIncomplete < StandardError; end

  # Resolve once per collection; only the TCP peer changes, never the TLS/HTTP hostname.
  class FixedHTTPFactory
    def initialize
      @addresses = HOSTS.to_h do |host|
        records = Addrinfo.getaddrinfo(host,443,Socket::AF_INET,Socket::SOCK_STREAM)
        raise AddressResolutionFailure unless !records.empty? && records.all? { |record| record.ipv4? && StagingStorageAccess.public_ipv4?(record.ip_address) }
        [host,records.first.ip_address.freeze]
      end.freeze
      freeze
    rescue SocketError, IPAddr::InvalidAddressError
      raise AddressResolutionFailure
    end

    def build(uri)
      raise FixedTransportRefused unless uri.is_a?(URI::HTTPS) && HOSTS.include?(uri.host) && uri.port == 443 && !uri.userinfo && !uri.fragment
      http = Net::HTTP.new(uri.host,443,nil)
      http.ipaddr = @addresses.fetch(uri.host)
      http.use_ssl = true
      http.verify_mode = OpenSSL::SSL::VERIFY_PEER
      http.verify_hostname = true
      http.ca_file = CA
      http.min_version = OpenSSL::SSL::TLS1_2_VERSION
      http.open_timeout = 3
      http.read_timeout = 5
      http.max_retries = 0
      raise FixedTransportRefused unless http.address == uri.host && http.port == 443 && !http.proxy? && http.ipaddr == @addresses.fetch(uri.host)
      http
    end
  end

  def self.public_ipv4?(address)
    ip = IPAddr.new(address)
    ip.ipv4? && NONPUBLIC_V4.none? { |range| range.include?(ip) }
  rescue IPAddr::InvalidAddressError
    false
  end

  # These objects belong only to this SDK client, preserving its signing/XML pipeline.
  class FixedHTTPPool < Seahorse::Client::NetHttp::ConnectionPool
    def initialize(factory,options)
      @fixed_factory = factory
      super(options)
    end

    private

    def start_session(endpoint)
      http = @fixed_factory.build(URI(endpoint))
      http.keep_alive_timeout = http_idle_timeout
      ExtendedSession.new(http.start)
    end
  end

  def self.storage_client(key,secret,factory)
    client = Aws::S3::Client.new(region: "auto", endpoint: ENDPOINT, force_path_style: true, credentials: Aws::Credentials.new(key,secret), retry_limit: 0, follow_redirects: false, http_proxy: nil, http_wire_trace: false, http_open_timeout: 3, http_read_timeout: 5, ssl_verify_peer: true, ssl_ca_bundle: CA)
    handler = Class.new(Seahorse::Client::NetHttp::Handler) do
      define_method(:pool_for) do |config|
        @fixed_pool ||= FixedHTTPPool.new(factory,pool_options(config))
      end
    end
    client.handlers.remove(Seahorse::Client::NetHttp::Handler)
    client.handlers.add(handler,step: :send)
    client
  end

  def self.failure_code(stage,error)
    return "r2_metadata_permission_required" if error.is_a?(MetadataPermission)
    return "r2_metadata_incomplete" if error.is_a?(MetadataIncomplete)
    return "r2_public_access_enabled" if error.is_a?(PublicAccessEnabled)
    return "r2_anonymous_access_not_denied" if error.is_a?(AnonymousNotDenied)
    return "r2_dns_failed" if stage == :dns || error.is_a?(AddressResolutionFailure)
    current = error
    4.times do
      return "r2_tls_failed" if current.is_a?(OpenSSL::SSL::SSLError)
      return "r2_connect_failed" if current.is_a?(Net::OpenTimeout) || current.is_a?(SocketError) || [Errno::ECONNREFUSED,Errno::EHOSTUNREACH,Errno::ENETUNREACH,Errno::ETIMEDOUT,Errno::ECONNRESET,Errno::ECONNABORTED].any? { |kind| current.is_a?(kind) }
      return "r2_access_timeout" if current.is_a?(Timeout::Error)
      nested = current.respond_to?(:original_error) ? current.original_error : current.cause
      break if !nested || nested.equal?(current)
      current = nested
    end
    {authenticated_head: "r2_authenticated_head_failed", authenticated_list: "r2_authenticated_list_failed", anonymous: "r2_anonymous_transport_failed", metadata: "r2_metadata_transport_failed"}.fetch(stage,"r2_access_failed")
  end

  def self.get(uri, headers = {}, factory:)
    http = factory.build(uri)
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
    stage = :setup
    begin
      raise "Fixed lease required" unless ARGV.empty? && ENV["ISP_STAGING_LEASE"] == LEASE && ENV["SSL_CERT_FILE"] == CA
      raise "Fixed CA required" if File.lstat(CA).symlink? || File.realpath(CA).tr(92.chr, "/").downcase != CA.downcase
      key = ENV.fetch("AWS_ACCESS_KEY_ID")
      secret = ENV.fetch("AWS_SECRET_ACCESS_KEY")
      token = ENV.fetch("ISP_CF_METADATA_TOKEN")
      raise "Credential shape refused" unless key.match?(/\A[A-Za-z0-9_+\/=-]{16,256}\z/) && secret.match?(/\A[A-Za-z0-9_+\/=-]{32,256}\z/) && token.match?(/\A[A-Za-z0-9._~+\/-]{32,4096}={0,2}\z/)
      receipt = nil
      Timeout.timeout(32) do
        observed_at = Time.now.utc.iso8601(3)
        stage = :dns
        factory = FixedHTTPFactory.new
        client = storage_client(key,secret,factory)
        stage = :authenticated_head
        head = bounded_s3(client,:head_bucket,{bucket: BUCKET},BODY_BOUND)
        raise AuthenticatedReadIncomplete unless head.context.http_response.status_code == 200
        stage = :authenticated_list
        listing = bounded_s3(client,:list_objects_v2,{bucket: BUCKET,max_keys: 1000},LIST_BODY_BOUND)
        head_status = head.context.http_response.status_code
        list_status = listing.context.http_response.status_code
        raise AuthenticatedReadIncomplete unless head_status == 200 && list_status == 200 && listing.is_truncated == false && listing.next_continuation_token.to_s.empty? && listing.contents.is_a?(Array) && listing.contents.length <= 1000 && listing.key_count == listing.contents.length
        stage = :anonymous
        anonymous = get(URI(ENDPOINT+"/"+BUCKET+"?list-type=2&max-keys=1"),factory: factory)
        denied, error_code = anonymous_denial(anonymous)
        raise AnonymousNotDenied unless denied
        base = "https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/r2/buckets/"+BUCKET+"/domains/"
        authorization = {"Authorization" => "Bearer "+token}
        stage = :metadata
        managed_response = get(URI(base+"managed"),authorization,factory: factory)
        managed = metadata(managed_response)
        custom_response = get(URI(base+"custom"),authorization,factory: factory)
        custom = metadata(custom_response)
        stage = :privacy
        private_routes!(managed,custom)
        receipt = {version: 1, kind: "r2-readonly-access", lease_id: LEASE, observed_at: observed_at, status: "PASS", read_only: true, tls_verified: true, authenticated_head_status: head_status, authenticated_list_status: list_status, anonymous_denied: true, anonymous_status: anonymous[:status], truncated: false, public_access_verified: true, private: true, access_verified: true, bucket: BUCKET, endpoint: ENDPOINT, managed_public_enabled: false, custom_domains_disabled: true, custom_domains_complete: true, cf_managed_status: managed_response[:status], cf_custom_status: custom_response[:status], cf_managed_sha256: managed_response[:sha256], cf_custom_sha256: custom_response[:sha256], object_count: listing.contents.length}
        receipt[:authentication_error_code] = error_code if anonymous[:status] == 400
      end
      puts JSON.generate(receipt)
      true
    rescue StandardError => error
      code = failure_code(stage,error)
      puts JSON.generate(version: 1, kind: "r2-readonly-access", lease_id: LEASE, observed_at: observed_at || Time.now.utc.iso8601(3), status: "BLOCKED", read_only: true, code: code)
      false
    end
  end
end
exit(StagingStorageAccess.collect ? 0 : 1) if $PROGRAM_NAME == __FILE__

require 'aws-sdk-s3'
require 'json'
require 'securerandom'
require 'net/http'
require 'openssl'

ACCOUNT = 'a9720867333b64a4f8ee70cdfd673eb9'
BUCKET = 'isp-staging-private'
private_file = 'D:/Projects/isp-rails-tools/isp-staging-private/r2.json'
key = "isp-acceptance-probes/#{SecureRandom.hex(24)}.txt"
client = nil
uploaded = false
result = {}; phase = "credential validation"
begin
  data = JSON.parse(File.read(private_file))
  raise 'Bucket mismatch' unless data.fetch('STORAGE_BUCKET') == BUCKET
  endpoint = "https://#{ACCOUNT}.r2.cloudflarestorage.com"
  client = Aws::S3::Client.new(region: 'auto', endpoint: endpoint, force_path_style: true,
    credentials: Aws::Credentials.new(data.fetch('AWS_ACCESS_KEY_ID'), data.fetch('AWS_SECRET_ACCESS_KEY')),
    retry_limit: 1, http_open_timeout: 10, http_read_timeout: 20, ssl_verify_peer: true)
  phase = "authenticated bucket HEAD"; client.head_bucket(bucket: BUCKET)
  result[:authenticated_bucket_head] = true
  content = "ISP synthetic private-file acceptance probe #{SecureRandom.hex(16)}"
  phase = "private object PUT"; client.put_object(bucket: BUCKET, key: key, body: content, content_type: 'text/plain', cache_control: 'no-store')
  uploaded = true
  phase = "private object GET"; raise 'Content mismatch' unless client.get_object(bucket: BUCKET, key: key).body.read == content
  result[:private_write_read] = true
  phase = "anonymous object GET"; uri = URI("#{endpoint}/#{BUCKET}/#{key}")
  response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, verify_mode: OpenSSL::SSL::VERIFY_PEER,
    open_timeout: 10, read_timeout: 20) { |http| http.get(uri.request_uri) }
  result[:anonymous_response_status] = response.code.to_i
  error_code = response.body.to_s[/<Code>([A-Za-z]+)<\/Code>/, 1]
  result[:anonymous_error_code] = error_code
  authentication_error = response.body.to_s.match?(/authentication|authorization|signature/i)
  rejected = [401, 403].include?(response.code.to_i) || (response.code.to_i == 400 && authentication_error && %w[InvalidArgument InvalidRequest AuthorizationHeaderMalformed SignatureDoesNotMatch].include?(error_code))
  raise 'Anonymous access was not denied' unless rejected && response.body != content
  result[:anonymous_get_denied] = response.code.to_i
rescue Exception => e
  warn JSON.generate(result.merge(status: 'failed', phase: phase, error_class: e.class.name))
  raise
ensure
  if uploaded && client
    client.delete_object(bucket: BUCKET, key: key)
    begin
      client.head_object(bucket: BUCKET, key: key)
      raise 'Probe remained after deletion'
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
      result[:probe_deleted_verified] = true
    end
  end
end
puts JSON.generate(result.merge(status: 'passed', scope: 'direct R2 only; hosted Rails verification pending'))
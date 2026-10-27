require "json"
require "stringio"
require "base64"
require "digest"
require "socket"
require "erb"
require "yaml"
require "pathname"
require "active_support/all"
require "active_storage"
require "active_storage/service"
require "active_storage/service/s3_service"
$blocked_network_calls=0
module OfflineSocketFence
 def tcp(*)
  $blocked_network_calls+=1
  raise "offline_network_forbidden"
 end
end
Socket.singleton_class.prepend(OfflineSocketFence)
root=File.expand_path("..",__dir__)
source=File.binread(root+"/config/storage.yml")
fake={"AWS_ACCESS_KEY_ID"=>"SYNTHETIC_ACCESS_KEY","AWS_SECRET_ACCESS_KEY"=>"SYNTHETIC_SECRET_KEY","AWS_REGION"=>"auto","STORAGE_BUCKET"=>"synthetic-offline-bucket","STORAGE_ENDPOINT"=>"https://a9720867333b64a4f8ee70cdfd673eb9.r2.cloudflarestorage.com","STORAGE_FORCE_PATH_STYLE"=>"true"}
scope=Module.new
scope.const_set(:ENV,fake.freeze)
rails=Module.new
rails.define_singleton_method(:root){Pathname.new(root)}
scope.const_set(:Rails,rails)
config=YAML.safe_load(scope.module_eval(ERB.new(source).src),aliases:true).fetch("production_private").transform_keys(&:to_sym)
raise "unexpected_service" unless config.delete(:service)=="S3"
raise "preexisting_override" if config.key?(:request_checksum_calculation)
payload="synthetic offline upload bytes\n".b
checksum=Base64.strict_encode64(Digest::MD5.digest(payload))
original=ENV["AWS_REQUEST_CHECKSUM_CALCULATION"]
begin
 scenarios=[{name:"actual_config_default",env:nil,option:nil},{name:"config_when_required",env:nil,option:"when_required"},{name:"process_env_when_required",env:"when_required",option:nil},{name:"explicit_option_precedes_env",env:"when_required",option:"when_supported"}]
 reports=scenarios.map do |scenario|
  scenario[:env] ? ENV["AWS_REQUEST_CHECKSUM_CALCULATION"]=scenario[:env] : ENV.delete("AWS_REQUEST_CHECKSUM_CALCULATION")
  options=config.merge(stub_responses:true,retry_limit:0,http_proxy:nil)
  options[:request_checksum_calculation]=scenario[:option] if scenario[:option]
  service=ActiveStorage::Service::S3Service.new(**options)
  service.upload("synthetic-offline-key",StringIO.new(payload),checksum:checksum,content_type:"application/octet-stream")
  client=service.client.client
  requests=client.api_requests
  raise "unexpected_request_count" unless requests.size==1&&requests[0][:operation_name]==:put_object
  wire=requests[0][:context].http_request
  bytes=wire.body.read;wire.body.rewind
  raise "wire_bytes_changed" unless bytes==payload
  headers=wire.headers.to_h.select{|k,_|k.downcase=="content-md5"||k.downcase.include?("checksum")||["x-amz-trailer","content-encoding"].include?(k.downcase)}
  raise "md5_not_preserved" unless headers["content-md5"]==checksum
  expected=scenario[:option]||scenario[:env]||"when_supported"
  raise "wrong_mode" unless client.config.request_checksum_calculation==expected
  raise "unexpected_crc" unless headers.key?("x-amz-checksum-crc32")== (expected=="when_supported")
  send_handlers=client.handlers.entries.select{|e|e.step==:send}.map{|e|e.handler_class.name}
  raise "transport_not_stubbed" unless send_handlers==["Aws::Plugins::StubResponses::StubbingHandler"]
  {scenario:scenario[:name],effective_mode:client.config.request_checksum_calculation,stub_responses:client.config.stub_responses,requests:requests.size,headers:headers,body_bytes:bytes.bytesize,body_sha256:Digest::SHA256.hexdigest(bytes),send_handlers:send_handlers}
 end
 raise "network_attempted" unless $blocked_network_calls==0
 puts JSON.generate({kind:"offline_active_storage_checksum_wire",ruby:RUBY_VERSION,versions:%w[activestorage aws-sdk-s3 aws-sdk-core].to_h{|g|[g,Gem.loaded_specs.fetch(g).version.to_s]},storage_source_sha256:Digest::SHA256.hexdigest(source),reports:reports,blocked_network_calls:$blocked_network_calls,provider_requests:0})
ensure
 original ? ENV["AWS_REQUEST_CHECKSUM_CALCULATION"]=original : ENV.delete("AWS_REQUEST_CHECKSUM_CALCULATION")
end

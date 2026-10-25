require "stringio"
require "digest"
require "base64"

namespace :production do
  desc "Check runtime dependencies without sending mail or approving release"
  task preflight: :environment do
    abort "Use RAILS_ENV=production." unless Rails.env.production?
    ProductionConfiguration.validate!
    ActiveRecord::Base.connection_pool.with_connection { |connection| connection.select_value("SELECT 1") }
    ActiveRecord::Migration.check_all_pending!
    abort "Sample review accounts must not exist in production." if User.where(email: %w[member@example.com admin@example.com]).exists?
    abort "Default Active Storage routes must stay disabled." if Rails.application.config.active_storage.draw_routes
    abort "The demo login route must not exist in production." if Rails.application.routes.routes.any? { |route| route.path.spec.to_s.start_with?("/demo_session") }
    scanner_error = UploadScanner.new.readiness_error
    abort scanner_error if scanner_error
    service = ActiveStorage::Blob.service
    abort "The private S3 storage service is required." unless service.is_a?(ActiveStorage::Service::S3Service) && !service.public?
    key = "health/preflight-#{SecureRandom.hex(16)}"
    payload = SecureRandom.hex(32)
    begin
      service.upload(key, StringIO.new(payload), checksum: Base64.strict_encode64(Digest::MD5.digest(payload)))
      abort "Object storage verification failed." unless service.download(key) == payload
    ensure
      service.delete(key)
    end
    puts "Runtime checks passed: database/schema, demo-account/route guards, private storage write/read/delete, scanner reachability and signature freshness."
    puts "RELEASE STILL REQUIRES: approved membership/admin/MFA and sender setup, successful mail and clean/EICAR/outage upload drills, private-bucket policy evidence, PostgreSQL CI, restore/rollback and owner sign-off. See docs/PRODUCTION-OPERATIONS.md."
  end
end

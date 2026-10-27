# Only the CI PostgreSQL18 service may execute this SQL syntax/consistency check.
require "json"
require "pg"
require "digest"
require_relative "recovery-fingerprint-inventory"
begin
  raise "ci_only" unless ENV["GITHUB_ACTIONS"] == "true" && ENV["RAILS_ENV"] == "test"
  # Rails test configuration uses TEST_DATABASE_URL. Refuse an overriding global URL before boot.
  raise "ci_url_override" unless ENV["DATABASE_URL"].to_s.empty?
  config = PG::Connection.conninfo_parse(ENV.fetch("TEST_DATABASE_URL")).to_h { |row| [row[:keyword],row[:val]] }.compact
  raise "ci_target" unless %w[localhost 127.0.0.1].include?(config["host"]) && config["dbname"] == "isp_test"
  raise "ci_target" if %w[hostaddr service options].any? { |key| config[key].to_s.length.positive? }
  require_relative "../config/environment"
  ActiveRecord::Base.logger = nil
  ActiveRecord::Base.connection_pool.with_connection do |connection|
    raw = connection.raw_connection
    info = raw.conninfo_hash
    raise "ci_target" unless %w[localhost 127.0.0.1].include?(info[:host]) && raw.db == "isp_test" && raw.server_version / 10_000 == 18 && raw.transaction_status == PG::PQTRANS_IDLE
    begin
      raw.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
      raw.exec("SET LOCAL statement_timeout='10s'")
      raw.exec("SET LOCAL lock_timeout='3s'")
      actor_ids = raw.exec("SELECT id FROM public.users ORDER BY id").map { |row| Integer(row.fetch("id")) }
      binding = {"operation_id"=>"ci-sql-only","lease_id"=>"ci-local-only","manifest_sha256"=>Digest::SHA256.hexdigest(JSON.generate(actor_ids)),"prepared_release_sha256"=>Digest::SHA256.hexdigest("ci-sql-only")}
      decrypt = ->(value) { ActiveRecord::Encryption.encryptor.decrypt(value) }
      first = RecoveryFingerprintInventory.collect(raw,actor_ids:actor_ids,binding:binding,decrypt:decrypt)
      second = RecoveryFingerprintInventory.collect(raw,actor_ids:actor_ids,binding:binding,decrypt:decrypt)
      result = RecoveryFingerprintInventory.compare!(first,second)
      puts JSON.generate(ok:true,version:2,tables:result.fetch("tables"),sequences:result.fetch("sequences"),read_only:true,isolation:"repeatable read",scope:"CI PostgreSQL18 catalog SQL and consistent read-only collection only",restore_rollback:"NOT RUN")
    ensure
      raw.exec("ROLLBACK") unless raw.transaction_status == PG::PQTRANS_IDLE
    end
  end
rescue StandardError
  warn "CI recovery inventory refused or failed; no connection details displayed."
  exit 1
end


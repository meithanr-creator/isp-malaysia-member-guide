# CI PostgreSQL18 catalog consistency only; recovery suitability is reported separately.
require "json"
require "pg"
require "digest"
require_relative "recovery-fingerprint-inventory"
stage = "environment_guard"
rollback_failed = false
begin
  raise "ci_only" unless ENV["GITHUB_ACTIONS"] == "true" && ENV["RAILS_ENV"] == "test"
  stage = "url_guard"
  raise "ci_url_override" unless ENV["DATABASE_URL"].to_s.empty?
  config = PG::Connection.conninfo_parse(ENV.fetch("TEST_DATABASE_URL")).to_h { |row| [row[:keyword],row[:val]] }.compact
  raise "ci_target" unless %w[localhost 127.0.0.1].include?(config["host"]) && config["dbname"] == "isp_test"
  raise "ci_target" if %w[hostaddr service options].any? { |key| config[key].to_s.length.positive? }
  stage = "rails_boot"
  require_relative "../config/environment"
  ActiveRecord::Base.logger = nil
  stage = "connection_validation"
  ActiveRecord::Base.connection_pool.with_connection do |connection|
    raw = connection.raw_connection
    info = raw.conninfo_hash
    RecoveryFingerprintInventory.validate_ci_target!(expected_host:config.fetch("host"),hosts:info[:host],address:raw.hostaddr,database:raw.db,server_version:raw.server_version,idle:raw.transaction_status == PG::PQTRANS_IDLE)
    original_error = nil
    begin
      stage = "read_only_transaction"
      raw.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
      raw.exec("SET LOCAL statement_timeout='10s'")
      raw.exec("SET LOCAL lock_timeout='3s'")
      actor_ids = raw.exec("SELECT id FROM public.users ORDER BY id").map { |row| Integer(row.fetch("id")) }
      binding = {"operation_id"=>"ci-sql-only","lease_id"=>"ci-local-only","manifest_sha256"=>Digest::SHA256.hexdigest(JSON.generate(actor_ids)),"prepared_release_sha256"=>Digest::SHA256.hexdigest("ci-sql-only")}
      decrypt = ->(value) { ActiveRecord::Encryption.encryptor.decrypt(value) }
      stage = "collect_first"
      first = RecoveryFingerprintInventory.collect(raw,actor_ids:actor_ids,binding:binding,decrypt:decrypt)
      stage = "collect_second"
      second = RecoveryFingerprintInventory.collect(raw,actor_ids:actor_ids,binding:binding,decrypt:decrypt)
      stage = "catalog_compare"
      result = RecoveryFingerprintInventory.compare_catalog!(first,second)
      stage = "recovery_suitability"
      suitability = begin
        RecoveryFingerprintInventory.compare!(first,second)
        {status:"PASS_FOR_SUPPLIED_INVENTORY_ONLY",restore_rollback:"NOT RUN"}
      rescue RecoveryFingerprintInventory::Refused => error
        code = error.message.match?(/\A[a-z_]{1,100}\z/) ? error.message : "inventory_refused"
        {status:"BLOCKED",refusal_code:code,restore_rollback:"NOT RUN"}
      end
      stage = "report"
      puts JSON.generate(ok:true,version:3,tables:result.fetch("tables"),sequences:result.fetch("sequences"),read_only:true,isolation:"repeatable read",catalog_consistency:"PASS",recovery_suitability:suitability,scope:"CI PostgreSQL18 catalog SQL and exact repeated read only",restore_rollback:"NOT RUN")
    rescue StandardError => error
      original_error = error
      raise
    ensure
      begin
        raw.exec("ROLLBACK") unless raw.transaction_status == PG::PQTRANS_IDLE
      rescue StandardError
        rollback_failed = true
        stage = "rollback" unless original_error
        raise unless original_error
      end
    end
  end
rescue StandardError => error
  classes = %w[RuntimeError KeyError TypeError ArgumentError NameError NoMethodError PG::Error PG::UndefinedColumn PG::UndefinedTable PG::SyntaxError PG::InFailedSqlTransaction PG::ConnectionBad PG::QueryCanceled PG::LockNotAvailable RecoveryFingerprintInventory::Refused ActiveRecord::ConnectionNotEstablished ActiveRecord::Encryption::Errors::Decryption]
  label = classes.include?(error.class.name) ? error.class.name : "UnclassifiedError"
  refusal = if error.is_a?(RecoveryFingerprintInventory::Refused) && error.message.match?(/\A[a-z_]{1,100}\z/)
    error.message
  elsif %w[ci_only ci_url_override ci_target].include?(error.message)
    error.message
  end
  state = error.is_a?(PG::Error) && error.result ? error.result.error_field(PG::PG_DIAG_SQLSTATE) : nil
  state = nil unless state&.match?(/\A[A-Z0-9]{5}\z/)
  warn JSON.generate(ok:false,stage:stage,error_class:label,refusal_code:refusal,sqlstate:state,rollback_failed:rollback_failed,scope:"CI local PostgreSQL18 only; no connection details displayed")
  exit 1
end

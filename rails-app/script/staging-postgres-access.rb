# Standalone fixed-target SELECT/SHOW only; no Rails boot, fixtures or application writes.
require "json"
require "pg"
require "time"
require "timeout"
require "uri"

module StagingPostgresAccess
  LEASE = "rails-staging-3"
  HOST = "ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech"
  DATABASE = "neondb"
  PROJECT = "royal-glitter-45740959"
  CA = "D:/Projects/isp-rails-tools/ruby34-devkit/lib/ruby/3.4.0/etc/ssl/cert.pem"
  def self.hosts_match?(value)
    value.is_a?(String) && !value.empty? && value.split(",", -1).all? { |candidate| candidate == HOST }
  end

  def self.collect
    connection = nil
    transaction = false
    failed = false
    observed_at = nil
    receipt = nil
    begin
      raise "Fixed lease required" unless ARGV.empty? && ENV["ISP_STAGING_LEASE"] == LEASE
      raise "Fixed TLS configuration required" unless ENV["NEON_VERIFY_HOST"] == HOST && ENV["DB_SSLMODE"] == "verify-full" && ENV["PGSSLROOTCERT"] == CA
      raise "Fixed certificate required" if File.lstat(CA).symlink? || File.realpath(CA).tr(92.chr, "/").downcase != CA.downcase
      url = ENV.fetch("DATABASE_URL_UNPOOLED")
      uri = URI.parse(url)
      pairs = URI.decode_www_form(uri.query.to_s)
      raise "Fixed direct database required" unless %w[postgres postgresql].include?(uri.scheme) && uri.host == HOST && uri.path == "/"+DATABASE && uri.user && uri.password && uri.fragment.nil? && [nil,5432].include?(uri.port)
      raise "Target overrides refused" unless pairs.count { |k,v| k == "sslmode" && v == "verify-full" } == 1 && pairs.all? { |k,v| k == "sslmode" || (k == "channel_binding" && v == "require") } && pairs.count { |k,v| k == "channel_binding" } <= 1
      options = PG::Connection.conninfo_parse(url).to_h { |entry| [entry[:keyword].to_sym,entry[:val]] }.reject { |_,value| value.nil? }
      raise "Connection target override refused" unless options[:host] == HOST && options[:dbname] == DATABASE && %i[hostaddr service options].all? { |key| options[key].to_s.empty? }
      observed_at = Time.now.utc.iso8601(3)
      Timeout.timeout(30) do
        connection = PG.connect(options.merge(host: HOST, dbname: DATABASE, port: 5432, connect_timeout: 5, sslmode: "verify-full", sslrootcert: CA, application_name: "isp-staging-readonly-access"))
        connection.set_notice_processor { |_notice| }
        info = connection.conninfo_hash
        tls = connection.ssl_attributes
        raise "Actual PostgreSQL/TLS target mismatch" unless hosts_match?(info[:host]) && connection.db == DATABASE && info[:sslmode] == "verify-full" && connection.ssl_in_use? && connection.server_version / 10_000 == 18
        raise "Actual TLS attributes unavailable" unless tls["protocol"].to_s.match?(/\ATLSv1\.[23]\z/) && !tls["cipher"].to_s.empty?
        connection.exec("BEGIN READ ONLY")
        transaction = true
        connection.exec("SET LOCAL statement_timeout = '5s'")
        connection.exec("SET LOCAL lock_timeout = '2s'")
        readonly = connection.exec("SHOW transaction_read_only").getvalue(0,0)
        database = connection.exec("SELECT current_database()").getvalue(0,0)
        raise "Read-only transaction mismatch" unless readonly == "on" && database == DATABASE
        receipt = {version: 1, kind: "postgresql-readonly-access", lease_id: LEASE, observed_at: observed_at, status: "PASS", read_only: true, transaction_read_only: readonly, ssl_verified: true, tls_protocol: tls["protocol"], tls_cipher: tls["cipher"], project: PROJECT, host: HOST, database: DATABASE, pg_major: 18, sslmode: "verify-full", project_identity_basis: "approved_host_mapping; not_a_server_reported_project_id"}
      end
    rescue StandardError
      failed = true
    ensure
      begin
        connection.exec("ROLLBACK") if connection && !connection.finished? && transaction
      rescue StandardError
        failed = true
      end
      begin
        connection.close if connection && !connection.finished?
      rescue StandardError
        failed = true
      end
    end
    if failed || receipt.nil?
      puts JSON.generate(version: 1, kind: "postgresql-readonly-access", lease_id: LEASE, observed_at: observed_at || Time.now.utc.iso8601(3), status: "BLOCKED", read_only: true, code: "postgresql_access_failed")
      return false
    end
    puts JSON.generate(receipt)
    true
  end
end
exit(StagingPostgresAccess.collect ? 0 : 1) if $PROGRAM_NAME == __FILE__

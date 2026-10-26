# Read-only, fixed-project snapshot/restore evidence. Private rows never leave memory.
require "json"
require "pg"
require "digest"
require "uri"
ROOT = "D:/Projects/isp-rails-tools/isp-staging-private"
PARENT = "ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech"
PROJECT = "royal-glitter-45740959"
def demand(value) = (raise "Restore fingerprint refused" unless value)
begin
  mode = ARGV.fetch(0)
  demand(ARGV.length == 1 && %w[capture verify parent].include?(mode))
  manifest = JSON.parse(File.read("#{ROOT}/acceptance-fixtures.json"))
  demand(manifest["phase"] == "active" && manifest.dig("target", "project") == PROJECT)
  host, url = PARENT, ENV.fetch("DATABASE_URL_UNPOOLED")
  if mode == "verify"
    target = JSON.parse(File.read("#{ROOT}/neon-restore-target.json"))
    demand(target["project"] == PROJECT && target["branch_id"].to_s.start_with?("br-"))
    host, url = target.fetch("host"), target.fetch("url")
    demand(host != PARENT && host.match?(/\A[a-z0-9-]+\.ap-southeast-1\.aws\.neon\.tech\z/) && !host.include?("-pooler"))
  end
  options = PG::Connection.conninfo_parse(url).to_h { |row| [row[:keyword].to_sym, row[:val]] }.compact
  demand(options[:host] == host && options[:dbname] == "neondb" && options[:sslmode] == "verify-full")
  demand(%i[hostaddr service options].none? { |key| options[key].to_s.length.positive? })
  conn = PG.connect(options.merge(connect_timeout: 10, sslmode: "verify-full"))
  demand(conn.ssl_in_use? && conn.conninfo_hash[:sslmode] == "verify-full" && conn.server_version / 10000 == 18)
  candidates = conn.conninfo_hash[:host].to_s.split(",", -1)
  demand(candidates.any? && candidates.all? { |candidate| candidate == host })
  conn.exec("SET statement_timeout='10s'"); conn.exec("SET lock_timeout='3s'"); conn.exec("SET TIME ZONE 'UTC'")
  conn.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
  demand(conn.exec("SHOW transaction_read_only").getvalue(0, 0) == "on")
  names = conn.exec("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").column_values(0)
  demand(names.include?("users") && names.include?("schema_migrations") && names.length <= 50)
  tables = names.to_h do |name|
    digest = Digest::SHA256.new; count = 0
    conn.exec("SELECT to_jsonb(t)::text AS row FROM #{conn.quote_ident(name)} t ORDER BY to_jsonb(t)::text").each do |row|
      bytes = row.fetch("row"); digest.update([bytes.bytesize].pack("Q>")).update(bytes); count += 1
    end
    [name, {"count"=>count, "sha256"=>digest.hexdigest}]
  end
  actors = conn.exec("SELECT id FROM users ORDER BY id").column_values(0).map(&:to_i)
  demand(actors == manifest.fetch("actors").values.map { |actor| actor.fetch("id") }.sort)
  schema = conn.exec("SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position").to_a
  constraints = conn.exec("SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname").to_a
  indexes = conn.exec("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname").to_a
  secrets = conn.exec("SELECT id,otp_secret FROM users WHERE otp_secret IS NOT NULL ORDER BY id").map do |row|
    plain = ActiveRecord::Encryption.encryptor.decrypt(row.fetch("otp_secret"))
    demand(plain.match?(/\A[A-Z2-7]{16,128}\z/))
    [row.fetch("id"), Digest::SHA256.hexdigest(plain)]
  end
  identity = conn.exec("SELECT pg_current_wal_flush_lsn()::text AS lsn,clock_timestamp()::text AS observed_at").first
  conn.exec("COMMIT")
  fingerprint = {"version"=>1,"tables"=>tables,"schema_sha256"=>Digest::SHA256.hexdigest(JSON.generate([schema,constraints,indexes])),"mfa_digests"=>secrets,"lsn"=>identity.fetch("lsn"),"captured_at"=>Time.now.utc.iso8601(6)}
  baseline_path = "#{ROOT}/neon-restore-baseline.json"
  if mode == "capture"
    demand(!File.exist?(baseline_path)); File.write(baseline_path,JSON.pretty_generate(fingerprint),mode:"w",perm:0o600)
  else
    baseline = JSON.parse(File.read(baseline_path))
    demand(fingerprint["tables"] == baseline["tables"] && fingerprint["schema_sha256"] == baseline["schema_sha256"] && fingerprint["mfa_digests"] == baseline["mfa_digests"])
    File.write("#{ROOT}/neon-restore-#{mode}-verified.json",JSON.pretty_generate(fingerprint),mode:"w",perm:0o600)
  end
  puts JSON.generate(ok:true,mode:mode,tables:tables.length,actors:actors.length,registry:tables.fetch("membership_registry_entries").fetch("count"),mfa_decrypted:secrets.length,read_only:true,matched:mode != "capture")
rescue StandardError => error
  File.write("#{ROOT}/neon-restore-fingerprint-error.txt","#{error.class}: #{error.message}\n#{Array(error.backtrace).first(8).join("\n")}",mode:"w",perm:0o600)
  warn "Read-only restore fingerprint failed; private details withheld."; exit 1
ensure
  conn&.close
end

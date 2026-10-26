# Standalone pg check: no Rails boot, fixtures, seeds, accounts or application tables.
require "json"
require "pg"
require "securerandom"
require "uri"

connections = []
created = false
cleaned = false
failure = nil
checks = {}
table_name = "isp_neon_probe_#{SecureRandom.hex(12)}"
quoted_table = PG::Connection.quote_ident(table_name)

begin
  database_url = ENV.fetch("DATABASE_URL_UNPOOLED") { ENV.fetch("DATABASE_URL", "") }
  uri = URI.parse(database_url)
  expected_host = ENV.fetch("NEON_VERIFY_HOST", "").downcase
  neon_host = /\A[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech\z/i
  unless %w[postgres postgresql].include?(uri.scheme) && uri.host && uri.user && uri.path.to_s.length > 1 && expected_host.match?(neon_host) && uri.host.downcase == expected_host
    raise ArgumentError, "The URL must target the explicit approved Neon host."
  end
  connection_options = PG::Connection.conninfo_parse(database_url).each_with_object({}) { |entry, options| options[entry[:keyword].to_sym] = entry[:val] unless entry[:val].nil? }

  connect = lambda do
    connection = PG.connect(connection_options.merge(connect_timeout: 10, sslmode: "verify-full", application_name: "isp-neon-synthetic-verification"))
    connections << connection
    # Neon terminates client TLS at its proxy; backend pg_stat_ssl describes another hop.
    info = connection.conninfo_hash
    raise "Unexpected connection target or TLS mode." unless info[:host].to_s.split(",").any? && info[:host].to_s.split(",").all? { |host| host.downcase == expected_host } && info[:sslmode] == "verify-full" && connection.ssl_in_use?
    tls_attributes = connection.ssl_attributes.slice("protocol", "cipher", "key_bits", "library")
    raise "TLS attributes unavailable." unless tls_attributes["protocol"].to_s.match?(/\ATLSv1\.[23]\z/) && !tls_attributes["cipher"].to_s.empty?
    (checks[:connections] ||= []) << { certificate_verification: info[:sslmode], tls: tls_attributes }
    connection.exec("SET statement_timeout = '10s'")
    connection.exec("SET lock_timeout = '3s'")
    connection
  end

  first = connect.call
  checks[:first_connection_tls] = true
  first.exec("CREATE TABLE public.#{quoted_table} (id text PRIMARY KEY, value text NOT NULL)")
  created = true
  key = SecureRandom.uuid
  initial_value = SecureRandom.hex(16)
  updated_value = SecureRandom.hex(16)
  first.exec_params("INSERT INTO public.#{quoted_table} (id, value) VALUES ($1, $2)", [key, initial_value])
  raise "Read check failed." unless first.exec_params("SELECT value FROM public.#{quoted_table} WHERE id = $1", [key]).getvalue(0, 0) == initial_value
  checks[:create_and_read] = true
  first.exec_params("UPDATE public.#{quoted_table} SET value = $1 WHERE id = $2", [updated_value, key])

  second = connect.call
  checks[:second_connection_tls] = true
  raise "Persistence check failed." unless second.exec_params("SELECT value FROM public.#{quoted_table} WHERE id = $1", [key]).getvalue(0, 0) == updated_value
  checks[:update_and_cross_connection_persistence] = true
  second.exec_params("DELETE FROM public.#{quoted_table} WHERE id = $1", [key])
  raise "Delete check failed." unless first.exec("SELECT count(*) FROM public.#{quoted_table}").getvalue(0, 0) == "0"
  checks[:delete_visible_across_connections] = true
rescue StandardError => error
  # Connection exception messages can include credentials. Print only the class.
  failure = error.class.name
ensure
  if created
    begin
      connections.find { |connection| !connection.finished? && connection.status == PG::CONNECTION_OK }.then do |connection|
        raise "No usable connection for cleanup." unless connection
        connection.exec("DROP TABLE public.#{quoted_table}")
      end
      cleaned = true
    rescue StandardError
      failure ||= "CleanupFailure"
      warn "Synthetic probe cleanup failed; remove only table public.#{table_name}."
    end
  end
  connections.each { |connection| connection.close unless connection.finished? }
end

if failure
  warn "Neon synthetic database verification failed (#{failure}); no connection details printed."
  exit 1
end
checks[:synthetic_table_removed] = cleaned
puts JSON.generate(checks)

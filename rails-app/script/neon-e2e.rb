# Run with Rails runner against the loopback development app on port 4181.
# One temporary model row; no fixtures, seeds, accounts, uploads or existing edits.
require "cgi"
require "json"
require "net/http"
require "pg"
require "securerandom"
require "uri"

class NeonLocalVerificationFailure < StandardError; end

def require_neon_check(condition, message)
  raise NeonLocalVerificationFailure, message unless condition
end

def local_get(path)
  http = Net::HTTP.new("127.0.0.1", 4181, nil)
  http.open_timeout = 3
  http.read_timeout = 10
  http.write_timeout = 3
  http.get(path, { "Cache-Control" => "no-cache" })
end

def require_verified_tls(connection)
  info = connection.conninfo_hash
  attributes = connection.ssl_attributes.slice("protocol", "cipher", "key_bits", "library")
  require_neon_check(info[:sslmode] == "verify-full" && connection.ssl_in_use? && attributes["protocol"].to_s.match?(/\ATLSv1\.[23]\z/) && !attributes["cipher"].to_s.empty?, "Certificate-verified TLS is required.")
  { certificate_verification: info[:sslmode], tls: attributes }
end

checks = { scope: "local development PostgreSQL/HTTP verification; not a production rehearsal" }
created_id = nil
secondary = nil
failure = nil
marker = "SYNTHETIC Neon verification #{SecureRandom.hex(10)}"
tag = "Synthetic staging check"

begin
  require_neon_check(Rails.env.development?, "This helper requires development mode.")
  expected_host = ENV.fetch("NEON_VERIFY_HOST", "").downcase
  direct_url = ENV.fetch("DATABASE_URL_UNPOOLED", "")
  uri = URI.parse(direct_url)
  require_neon_check(expected_host.match?(/\A[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech\z/) && !expected_host.include?("-pooler.") && %w[postgres postgresql].include?(uri.scheme) && uri.host.to_s.downcase == expected_host, "The approved direct Neon endpoint is required.")
  connection = ActiveRecord::Base.connection
  require_neon_check(connection.adapter_name == "PostgreSQL", "Rails must use PostgreSQL.")
  connection.execute("SET statement_timeout = '10s'")
  connection.execute("SET lock_timeout = '3s'")
  raw = connection.raw_connection
  require_neon_check(raw.conninfo_hash[:host].to_s.split(",").any? && raw.conninfo_hash[:host].to_s.split(",").all? { |host| host.downcase.sub("-pooler.", ".") == expected_host }, "Rails is not using the approved Neon endpoint.")
  checks[:rails_connection] = require_verified_tls(raw)
  direct_options = PG::Connection.conninfo_parse(direct_url).each_with_object({}) { |entry, options| options[entry[:keyword].to_sym] = entry[:val] unless entry[:val].nil? }
  secondary = PG.connect(direct_options.merge(connect_timeout: 10, sslmode: "verify-full", application_name: "isp-neon-local-e2e"))
  secondary.exec("SET statement_timeout = '10s'")
  require_neon_check(secondary.conninfo_hash[:host].to_s.split(",").any? && secondary.conninfo_hash[:host].to_s.split(",").all? { |host| host.downcase == expected_host } && secondary.db == raw.db, "The independent connection must use the same approved Neon database.")
  checks[:independent_connection] = require_verified_tls(secondary)
  require_neon_check(local_get("/up").code == "200", "The loopback app is not healthy on port 4181.")

  occupied = DiscoverSlide.pluck(:position)
  position = (1..3).find { |candidate| !occupied.include?(candidate) }
  require_neon_check(position, "No free Discover position; existing records were left unchanged.")
  slide = DiscoverSlide.create!(position: position, tag: tag, title: marker,
    description: "Temporary synthetic record for local Neon connectivity verification. Removed after this check.",
    website_url: DiscoverSlide::DEFAULTS.first.fetch(:website_url),
    image_alt: "Synthetic verification using a packaged reference image", default_image: DiscoverSlide::DEFAULT_IMAGES.first)
  created_id = slide.id
  checks[:model_create] = true
  stored = secondary.exec_params("SELECT title, tag FROM public.discover_slides WHERE id = $1", [created_id])
  require_neon_check(stored.ntuples == 1 && stored.getvalue(0, 0) == marker && stored.getvalue(0, 1) == tag, "The model write did not persist to the independent connection.")
  checks[:independent_connection_persistence] = true
  page = local_get("/?neon_probe=#{created_id}")
  require_neon_check(page.code == "200" && page.body.include?(CGI.escapeHTML(marker)), "The HTTP landing page did not render the unique database record.")
  checks[:landing_renders_unique_database_content] = true

  paths = %w[/member/dashboard /member/publications /member/profile/edit]
  paths.each do |path|
    response = local_get(path)
    location = URI.parse(response["Location"].to_s)
    local_login = location.path == "/login" && (location.host.nil? || (location.host == "127.0.0.1" && location.port == 4181 && location.scheme == "http"))
    require_neon_check(%w[302 303].include?(response.code) && local_login && response["Cache-Control"].to_s.include?("no-store"), "An anonymous member route did not redirect privately to login.")
  end
  checks[:anonymous_member_routes_redirect_to_login] = paths
rescue StandardError => error
  failure = error.is_a?(NeonLocalVerificationFailure) ? error.message : error.class.name
ensure
  if created_id
    begin
      removed = DiscoverSlide.where(id: created_id, title: marker, tag: tag).delete_all
      require_neon_check(removed == 1, "The exact synthetic record could not be removed.")
      require_neon_check(secondary.exec_params("SELECT count(*) FROM public.discover_slides WHERE id = $1", [created_id]).getvalue(0, 0) == "0", "Synthetic cleanup was not visible to the independent connection.")
      checks[:own_synthetic_record_removed] = true
    rescue StandardError
      failure ||= "Synthetic cleanup failed."
      warn "Inspect only synthetic DiscoverSlide id=#{created_id}, title=#{marker}."
    end
  end
  secondary.close if secondary && !secondary.finished?
end

if failure
  warn "Neon local E2E verification failed: #{failure} No connection details printed."
  exit 1
end
puts JSON.generate(checks)

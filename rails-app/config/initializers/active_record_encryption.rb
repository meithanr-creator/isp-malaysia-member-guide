require "digest"

names = %i[primary_key deterministic_key key_derivation_salt]
asset_build = ENV["SECRET_KEY_BASE_DUMMY"] == "1" && defined?(Rake) && Rake.respond_to?(:application) && Rake.application.top_level_tasks == [ "assets:precompile" ]
keys = names.to_h do |name|
  variable = "ACTIVE_RECORD_ENCRYPTION_#{name.to_s.upcase}"
  value = if Rails.env.production? && !asset_build
    ENV.fetch(variable)
  else
    # Local/test only: stable per local secret, never used in production runtime.
    ENV.fetch(variable) { Digest::SHA256.hexdigest("isp-local-only/#{name}/#{Rails.application.secret_key_base}") }
  end
  [ name, value ]
end
ActiveRecord::Encryption.configure(**keys)

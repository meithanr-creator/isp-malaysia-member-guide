require "openssl"
require "securerandom"
root = ENV.fetch("ISP_LOCAL_BROWSER_PRIVATE", "D:/Projects/isp-rails-tools/isp-staging-private")
key = OpenSSL::PKey::RSA.new(2048)
certificate = OpenSSL::X509::Certificate.new
certificate.version = 2
certificate.serial = SecureRandom.random_number(2**128)
certificate.subject = OpenSSL::X509::Name.parse("/CN=localhost")
certificate.issuer = certificate.subject
certificate.public_key = key.public_key
certificate.not_before = Time.now - 60
certificate.not_after = Time.now + 3600
factory = OpenSSL::X509::ExtensionFactory.new
factory.subject_certificate = certificate
factory.issuer_certificate = certificate
certificate.add_extension(factory.create_extension("basicConstraints", "CA:FALSE", true))
certificate.add_extension(factory.create_extension("keyUsage", "digitalSignature,keyEncipherment", true))
certificate.add_extension(factory.create_extension("extendedKeyUsage", "serverAuth", false))
certificate.add_extension(factory.create_extension("subjectAltName", "DNS:localhost,IP:127.0.0.1", false))
certificate.sign(key, OpenSSL::Digest::SHA256.new)
File.write("#{root}/local-browser-key.pem", key.to_pem, mode: "w", perm: 0o600)
File.write("#{root}/local-browser-cert.pem", certificate.to_pem, mode: "w", perm: 0o600)
puts "Local-only HTTPS fixture certificate created in the isolated test folder; no operating-system trust settings changed."

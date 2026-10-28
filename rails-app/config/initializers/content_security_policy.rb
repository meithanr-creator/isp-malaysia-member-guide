Rails.application.configure do
  config.content_security_policy do |policy|
    policy.default_src :self
    policy.base_uri :self
    policy.object_src :none
    policy.frame_ancestors :none
    policy.form_action :self
    policy.script_src :self
    policy.style_src :self
    policy.font_src :self
    policy.img_src :self, :data, :blob
    policy.connect_src :self
    policy.worker_src :self
  end
  config.content_security_policy_nonce_generator = ->(_request) { SecureRandom.base64(24) }
  config.content_security_policy_nonce_directives = %w[script-src]
  config.content_security_policy_nonce_auto = true
end

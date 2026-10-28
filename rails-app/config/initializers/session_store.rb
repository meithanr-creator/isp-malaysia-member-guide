Rails.application.config.session_store :cookie_store,
  key: "_isp_member_demo_session", same_site: :lax, httponly: true,
  secure: Rails.env.production?, expire_after: 12.hours
# The cookie carries an opaque token; UserSession enforces server expiry/revocation.

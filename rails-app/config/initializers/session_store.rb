Rails.application.config.session_store :cookie_store,
  key: "_isp_member_demo_session", same_site: :lax, secure: Rails.env.production?, expire_after: 12.hours

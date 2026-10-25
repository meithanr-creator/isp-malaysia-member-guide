# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_25_240000) do
  create_table "account_security_events", force: :cascade do |t|
    t.integer "user_id"
    t.integer "actor_id"
    t.string "action", null: false
    t.string "outcome", null: false
    t.datetime "created_at", null: false
    t.string "authorization_reference"
    t.string "operator_reference"
    t.index ["actor_id"], name: "index_account_security_events_on_actor_id"
    t.index ["user_id"], name: "index_account_security_events_on_user_id"
  end

  create_table "account_tokens", force: :cascade do |t|
    t.integer "user_id", null: false
    t.string "purpose", null: false
    t.string "token_digest", null: false
    t.string "authentication_fingerprint", null: false
    t.datetime "expires_at", null: false
    t.datetime "consumed_at"
    t.string "delivery_status", default: "pending", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "delivery_token"
    t.datetime "delivery_lease_at"
    t.index ["expires_at"], name: "index_account_tokens_on_expires_at"
    t.index ["purpose", "delivery_status"], name: "index_account_tokens_on_purpose_and_delivery_status"
    t.index ["token_digest"], name: "index_account_tokens_on_token_digest", unique: true
    t.index ["user_id", "purpose"], name: "index_account_tokens_on_user_id_and_purpose"
    t.index ["user_id"], name: "index_account_tokens_on_user_id"
    t.check_constraint "purpose IN ('activation', 'recovery')", name: "account_tokens_purpose_valid"
  end

  create_table "active_storage_attachments", force: :cascade do |t|
    t.string "name", null: false
    t.string "record_type", null: false
    t.bigint "record_id", null: false
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.string "key", null: false
    t.string "filename", null: false
    t.string "content_type"
    t.text "metadata"
    t.string "service_name", null: false
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.datetime "created_at", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

  create_table "administrative_audits", force: :cascade do |t|
    t.integer "actor_id", null: false
    t.string "target_type", null: false
    t.bigint "target_id"
    t.integer "revision", null: false
    t.string "action", null: false
    t.string "outcome", null: false
    t.datetime "occurred_at", null: false
    t.index ["actor_id"], name: "index_administrative_audits_on_actor_id"
    t.index ["target_type", "target_id"], name: "index_administrative_audits_on_target_type_and_target_id"
  end

  create_table "authentication_challenges", force: :cascade do |t|
    t.integer "user_id", null: false
    t.string "token_digest", null: false
    t.string "authentication_fingerprint", null: false
    t.text "otp_secret"
    t.datetime "expires_at", null: false
    t.datetime "consumed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "recovery_codes"
    t.datetime "codes_viewed_at"
    t.index ["expires_at"], name: "index_authentication_challenges_on_expires_at"
    t.index ["token_digest"], name: "index_authentication_challenges_on_token_digest", unique: true
    t.index ["user_id"], name: "index_authentication_challenges_on_user_id"
  end

  create_table "consultation_requests", force: :cascade do |t|
    t.integer "user_id", null: false
    t.string "category", null: false
    t.string "subject", null: false
    t.text "message", null: false
    t.string "request_key", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id", "request_key"], name: "index_consultation_requests_on_user_id_and_request_key", unique: true
    t.index ["user_id"], name: "index_consultation_requests_on_user_id"
  end

  create_table "discover_slides", force: :cascade do |t|
    t.integer "position", null: false
    t.string "tag", null: false
    t.string "title", null: false
    t.text "description", null: false
    t.string "website_url", null: false
    t.string "image_alt", null: false
    t.string "default_image", null: false
    t.integer "lock_version", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["position"], name: "index_discover_slides_on_position", unique: true
  end

  create_table "event_interests", force: :cascade do |t|
    t.integer "user_id", null: false
    t.integer "event_id", null: false
    t.string "name", null: false
    t.string "email", null: false
    t.string "company"
    t.integer "event_revision"
    t.text "event_snapshot"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["event_id"], name: "index_event_interests_on_event_id"
    t.index ["user_id", "event_id"], name: "index_event_interests_on_user_id_and_event_id", unique: true
    t.index ["user_id"], name: "index_event_interests_on_user_id"
  end

  create_table "events", force: :cascade do |t|
    t.string "slug", null: false
    t.text "draft_data"
    t.text "preview_data"
    t.text "published_data"
    t.integer "revision", default: 0, null: false
    t.integer "preview_revision"
    t.datetime "published_at"
    t.integer "lock_version", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.integer "published_revision"
    t.index ["slug"], name: "index_events_on_slug", unique: true
  end

  create_table "login_attempt_buckets", force: :cascade do |t|
    t.string "scope_digest", null: false
    t.datetime "window_started_at", null: false
    t.datetime "expires_at", null: false
    t.integer "attempts", default: 0, null: false
    t.index ["expires_at"], name: "index_login_attempt_buckets_on_expires_at"
    t.index ["scope_digest", "window_started_at"], name: "idx_on_scope_digest_window_started_at_5fe36f9f3a", unique: true
  end

  create_table "membership_imports", force: :cascade do |t|
    t.string "public_id", null: false
    t.integer "actor_id", null: false
    t.string "state", null: false
    t.json "registry_rows", default: [], null: false
    t.json "validation_errors", default: [], null: false
    t.json "counts", default: {}, null: false
    t.string "digest", null: false
    t.integer "registry_version", null: false
    t.string "registry_fingerprint", null: false
    t.datetime "expires_at", null: false
    t.datetime "confirmed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["actor_id"], name: "index_membership_imports_on_actor_id"
    t.index ["expires_at"], name: "index_membership_imports_on_expires_at"
    t.index ["public_id"], name: "index_membership_imports_on_public_id", unique: true
    t.check_constraint "state IN ('ready', 'invalid', 'confirmed', 'expired')", name: "membership_import_state_valid"
  end

  create_table "membership_registry_audits", force: :cascade do |t|
    t.integer "membership_import_id", null: false
    t.integer "actor_id", null: false
    t.string "action", null: false
    t.string "digest", null: false
    t.json "counts", default: {}, null: false
    t.json "eligibility_changes", default: [], null: false
    t.datetime "occurred_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["actor_id"], name: "index_membership_registry_audits_on_actor_id"
    t.index ["membership_import_id", "action"], name: "index_membership_audits_on_import_and_action", unique: true
    t.index ["membership_import_id"], name: "index_membership_registry_audits_on_membership_import_id"
  end

  create_table "membership_registry_entries", force: :cascade do |t|
    t.string "name", limit: 80, null: false
    t.string "email", limit: 160, null: false
    t.string "member_reference", limit: 80, null: false
    t.string "status", null: false
    t.integer "user_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_membership_registry_entries_on_email", unique: true
    t.index ["member_reference"], name: "index_membership_registry_entries_on_member_reference", unique: true
    t.index ["user_id"], name: "index_membership_registry_entries_on_user_id", unique: true
    t.check_constraint "email = LOWER(TRIM(email))", name: "membership_registry_email_normalized"
    t.check_constraint "status IN ('eligible', 'ineligible')", name: "membership_registry_status_valid"
  end

  create_table "membership_registry_states", force: :cascade do |t|
    t.integer "revision", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "publications", force: :cascade do |t|
    t.string "slug", null: false
    t.text "draft_data"
    t.text "preview_data"
    t.text "published_data"
    t.integer "revision", default: 0, null: false
    t.integer "preview_revision"
    t.integer "published_revision"
    t.datetime "published_at"
    t.integer "lock_version", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_publications_on_slug", unique: true
  end

  create_table "user_sessions", force: :cascade do |t|
    t.integer "user_id", null: false
    t.string "token_digest", null: false
    t.string "authentication_fingerprint", null: false
    t.datetime "last_seen_at", null: false
    t.datetime "expires_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.datetime "mfa_verified_at"
    t.index ["expires_at"], name: "index_user_sessions_on_expires_at"
    t.index ["last_seen_at"], name: "index_user_sessions_on_last_seen_at"
    t.index ["token_digest"], name: "index_user_sessions_on_token_digest", unique: true
    t.index ["user_id"], name: "index_user_sessions_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "password_digest", null: false
    t.string "name", null: false
    t.string "role", default: "member", null: false
    t.string "company"
    t.string "branch"
    t.string "phone"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "account_status", default: "pending", null: false
    t.datetime "email_verified_at"
    t.text "otp_secret"
    t.datetime "otp_enabled_at"
    t.datetime "otp_last_used_at"
    t.text "recovery_code_digests"
    t.index ["email"], name: "index_users_on_email", unique: true
    t.check_constraint "account_status IN ('pending', 'active', 'suspended')", name: "users_account_status_valid"
  end

  add_foreign_key "account_security_events", "users", column: "actor_id", on_delete: :nullify
  add_foreign_key "account_security_events", "users", on_delete: :nullify
  add_foreign_key "account_tokens", "users"
  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "administrative_audits", "users", column: "actor_id"
  add_foreign_key "authentication_challenges", "users"
  add_foreign_key "consultation_requests", "users"
  add_foreign_key "event_interests", "events"
  add_foreign_key "event_interests", "users"
  add_foreign_key "membership_imports", "users", column: "actor_id"
  add_foreign_key "membership_registry_audits", "membership_imports"
  add_foreign_key "membership_registry_audits", "users", column: "actor_id"
  add_foreign_key "membership_registry_entries", "users"
  add_foreign_key "user_sessions", "users"
end

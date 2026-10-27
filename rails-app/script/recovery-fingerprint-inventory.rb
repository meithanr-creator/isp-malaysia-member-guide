# Read-only PostgreSQL18 inventory library. Requiring it never connects or reads private files.
require "json"
require "digest"
require "time"

module RecoveryFingerprintInventory
  class Refused < StandardError; end
  TABLES = <<~SQL.freeze
    SELECT n.nspname AS schema_name,c.relname AS table_name,c.relkind,c.relpersistence,
      c.relrowsecurity,c.relforcerowsecurity,c.relreplident,c.reloptions,
      pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl,
      am.amname AS access_method,pg_get_partkeydef(c.oid) AS partition_key,
      pg_get_expr(c.relpartbound,c.oid) AS partition_bound
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_am am ON am.oid=c.relam
    WHERE n.nspname='public' AND c.relkind IN ('r','p','f')
    ORDER BY n.nspname,c.relname
  SQL
  SCHEMA = <<~SQL.freeze
    SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl
    FROM pg_namespace WHERE nspname='public' ORDER BY nspname
  SQL
  COLUMNS = <<~SQL.freeze
    SELECT n.nspname AS schema_name,c.relname AS table_name,a.attnum,a.attname,
      format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
      a.attstorage,a.attcompression,cn.nspname AS collation_schema,co.collname,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_collation co ON co.oid=a.attcollation
    LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY n.nspname,c.relname,a.attnum
  SQL
  CONSTRAINTS = <<~SQL.freeze
    SELECT n.nspname AS schema_name,c.relname AS table_name,con.conname,con.contype,
      con.condeferrable,con.condeferred,con.convalidated,con.connoinherit,
      pg_get_constraintdef(con.oid,false) AS definition
    FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace
    LEFT JOIN pg_class c ON c.oid=con.conrelid
    WHERE n.nspname='public' ORDER BY n.nspname,c.relname,con.conname
  SQL
  INDEXES = <<~SQL.freeze
    SELECT n.nspname AS schema_name,t.relname AS table_name,c.relname AS index_name,
      pg_get_indexdef(i.indexrelid,0,false) AS definition,i.indisunique,i.indisprimary,
      i.indisexclusion,i.indimmediate,i.indisvalid,i.indisready,i.indislive,
      i.indisreplident,i.indnullsnotdistinct,c.reloptions
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' ORDER BY n.nspname,t.relname,c.relname
  SQL
  TYPES = <<~SQL.freeze
    SELECT n.nspname AS schema_name,t.typname,t.typtype,t.typnotnull,
      format_type(t.typbasetype,t.typtypmod) AS base_type,t.typdefault,
      e.enumlabel,e.enumsortorder::text
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    LEFT JOIN pg_enum e ON e.enumtypid=t.oid
    WHERE n.nspname='public' AND t.typtype IN ('d','e')
    ORDER BY n.nspname,t.typname,e.enumsortorder
  SQL
  SEQUENCES = <<~SQL.freeze
    SELECT sn.nspname AS sequence_schema,s.relname AS sequence_name,
      pg_get_userbyid(s.relowner) AS sequence_owner,s.relacl::text AS sequence_acl,
      format_type(q.seqtypid,NULL) AS data_type,q.seqstart::text,q.seqincrement::text,
      q.seqmin::text,q.seqmax::text,q.seqcache::text,q.seqcycle::text,
      tn.nspname AS owned_schema,t.relname AS owned_table,a.attname AS owned_column,
      d.deptype AS dependency_type,a.attidentity,
      pg_get_expr(ad.adbin,ad.adrelid) AS column_default
    FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_sequence q ON q.seqrelid=s.oid
    LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid
      AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
    LEFT JOIN pg_class t ON t.oid=d.refobjid
    LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    LEFT JOIN pg_attrdef ad ON ad.adrelid=t.oid AND ad.adnum=a.attnum
    WHERE s.relkind='S' AND (sn.nspname='public' OR tn.nspname='public')
    ORDER BY sn.nspname,s.relname,tn.nspname,t.relname,a.attname
  SQL
  MFA = "SELECT id::text,otp_secret FROM public.users WHERE otp_secret IS NOT NULL ORDER BY id".freeze
  ACTORS = "SELECT id::text FROM public.users ORDER BY id".freeze
  IDENTITY = "SELECT pg_current_wal_flush_lsn()::text AS lsn,clock_timestamp()::text AS observed_at".freeze
  COMPARABLE = %w[version binding tables schema columns constraints indexes types migrations mfa_digests].freeze
  module_function

  def demand(value, code = "inventory_refused")
    raise Refused, code unless value
  end

  def canonical(value)
    case value
    when Hash then value.keys.sort.to_h { |k| [k, canonical(value.fetch(k))] }
    when Array then value.map { |v| canonical(v) }
    else value
    end
  end

  def digest(value) = Digest::SHA256.hexdigest(JSON.generate(canonical(value)))
  def qualified(conn, schema, name) = "#{conn.quote_ident(schema)}.#{conn.quote_ident(name)}"
  def rows(conn, sql)
    result = conn.exec(sql).to_a
    demand(result.length <= 100_000, "inventory_result_bound")
    result
  end

  def collect(conn, actor_ids:, binding:, decrypt:, captured_at: Time.now.utc.iso8601(6))
    demand(conn.transaction_status == 2, "active_transaction_required")
    demand(conn.server_version / 10_000 == 18, "postgres18_required")
    demand(%w[repeatable\ read serializable].include?(conn.exec("SHOW transaction_isolation").first.fetch("transaction_isolation")), "consistent_isolation_required")
    demand(conn.exec("SHOW transaction_read_only").first.fetch("transaction_read_only") == "on", "read_only_required")
    demand(binding.is_a?(Hash) && %w[operation_id lease_id manifest_sha256 prepared_release_sha256].all? { |k| binding[k].is_a?(String) && !binding[k].empty? }, "inventory_binding")
    relations = rows(conn, TABLES)
    demand(relations.any? && relations.length <= 128 && relations.none? { |r| r["relkind"] == "f" }, "unsupported_table_inventory")
    demand(relations.map { |r| r.fetch("table_name") }.include?("users") && relations.map { |r| r.fetch("table_name") }.include?("schema_migrations"), "application_tables_required")
    tables = relations.to_h do |relation|
      name = qualified(conn, relation.fetch("schema_name"), relation.fetch("table_name"))
      hash = Digest::SHA256.new
      count = 0
      # ONLY avoids counting a partition twice while preserving every physical table.
      rows(conn, "SELECT to_jsonb(t)::text AS row FROM ONLY #{name} t ORDER BY to_jsonb(t)::text").each do |row|
        bytes = row.fetch("row")
        hash.update([bytes.bytesize].pack("Q>")).update(bytes)
        count += 1
      end
      [name, {"definition" => relation, "count" => count, "sha256" => hash.hexdigest}]
    end
    observed_ids = rows(conn, ACTORS).map { |r| Integer(r.fetch("id")) }.sort
    demand(actor_ids.is_a?(Array) && actor_ids.uniq.length == actor_ids.length && observed_ids == actor_ids.sort, "manifest_actor_mismatch")
    sequence_names = []
    sequences = rows(conn, SEQUENCES).map do |sequence|
      name = qualified(conn, sequence.fetch("sequence_schema"), sequence.fetch("sequence_name"))
      demand(!sequence_names.include?(name), "ambiguous_sequence_ownership")
      sequence_names << name
      state = rows(conn, "SELECT last_value::text,is_called::text FROM #{name}")
      demand(state.length == 1 && %w[true false].include?(state.first["is_called"]), "sequence_state_required")
      highwater = nil
      if sequence["owned_table"]
        demand(sequence["owned_schema"] == "public" && sequence["owned_column"] && %w[a i].include?(sequence["dependency_type"]), "sequence_ownership")
        table = qualified(conn, sequence.fetch("owned_schema"), sequence.fetch("owned_table"))
        column = conn.quote_ident(sequence.fetch("owned_column"))
        highwater = rows(conn, "SELECT MIN(#{column})::text AS minimum,MAX(#{column})::text AS maximum,COUNT(#{column})::text AS populated_count FROM #{table}").first
        demand(highwater && highwater.keys.sort == %w[maximum minimum populated_count], "sequence_highwater_required")
      end
      {"sequence" => name, "options_and_ownership" => sequence, "options_sha256" => digest(sequence),
       "state" => state.first, "highwater" => highwater}
    end
    mfa = rows(conn, MFA).map do |row|
      plain = decrypt.call(row.fetch("otp_secret"))
      demand(plain.is_a?(String) && plain.match?(/\A[A-Z2-7]{16,128}\z/), "mfa_decryption")
      [row.fetch("id"), Digest::SHA256.hexdigest(plain)]
    end
    identity = rows(conn, IDENTITY).first
    {"version" => 2, "binding" => binding, "tables" => tables, "schema" => rows(conn, SCHEMA),
     "columns" => rows(conn, COLUMNS), "constraints" => rows(conn, CONSTRAINTS),
     "indexes" => rows(conn, INDEXES), "types" => rows(conn, TYPES),
     "migrations" => rows(conn, "SELECT version FROM public.schema_migrations ORDER BY version"),
     "sequences" => sequences, "mfa_digests" => mfa, "lsn" => identity.fetch("lsn"),
     "observed_at" => identity.fetch("observed_at"), "captured_at" => captured_at}
  end

  def integer_state(value)
    demand(value.is_a?(String) && value.match?(/\A-?\d+\z/), "sequence_integer_state")
    Integer(value, 10)
  end

  def compare_sequences!(before, after)
    demand(before.is_a?(Array) && after.is_a?(Array) && before.map { |s| s.fetch("sequence") } == after.map { |s| s.fetch("sequence") }, "sequence_inventory_mismatch")
    before.zip(after).map do |original, restored|
      demand(original.fetch("options_and_ownership") == restored.fetch("options_and_ownership") && original.fetch("options_sha256") == restored.fetch("options_sha256") && original.fetch("highwater") == restored.fetch("highwater"), "sequence_options_ownership_highwater_mismatch")
      options = original.fetch("options_and_ownership")
      demand(options.fetch("seqcycle") == "false", "cyclic_sequence_requires_review")
      increment = integer_state(options.fetch("seqincrement"))
      minimum = integer_state(options.fetch("seqmin"))
      maximum = integer_state(options.fetch("seqmax"))
      demand(!increment.zero? && minimum < maximum, "sequence_options")
      initial = original.fetch("state")
      current = restored.fetch("state")
      a = integer_state(initial.fetch("last_value"))
      b = integer_state(current.fetch("last_value"))
      demand([initial.fetch("is_called"), current.fetch("is_called")].all? { |v| %w[true false].include?(v) }, "sequence_called_state")
      demand(!(initial.fetch("is_called") == "true" && current.fetch("is_called") == "false"), "sequence_called_state_regression")
      demand((increment.positive? ? b >= a : b <= a) && a.between?(minimum, maximum) && b.between?(minimum, maximum), "sequence_state_regression")
      demand(current.fetch("is_called") == "true" || b == a, "sequence_uncalled_state_change")
      candidate = current.fetch("is_called") == "true" ? b + increment : b
      demand(candidate.between?(minimum, maximum), "sequence_exhausted")
      if (highwater = restored.fetch("highwater"))
        high = highwater.fetch(increment.positive? ? "maximum" : "minimum")
        demand(high.nil? || (increment.positive? ? candidate > integer_state(high) : candidate < integer_state(high)), "sequence_next_candidate_collision")
      end
      {"sequence" => original.fetch("sequence"), "compatible" => true,
       "baseline_state" => initial, "restored_state" => current,
       "actual_generated_ids_verified" => false}
    end
  end

  def compare!(baseline, observed)
    demand(baseline["version"] == 2 && observed["version"] == 2, "inventory_version")
    COMPARABLE.each { |field| demand(baseline.fetch(field) == observed.fetch(field), "inventory_mismatch_#{field}") }
    states = compare_sequences!(baseline.fetch("sequences"), observed.fetch("sequences"))
    {"matched" => true, "read_only" => true, "tables" => observed.fetch("tables").length,
     "sequences" => observed.fetch("sequences").length, "mfa_decrypted" => observed.fetch("mfa_digests").length,
     "sequence_state_compatibility" => states,
     "scope" => "supplied_read_only_inventory_only", "restore_rollback" => "NOT RUN"}
  end
  def sequence_write_requirements(inventory)
    inventory.fetch("sequences").filter_map do |sequence|
      options = sequence.fetch("options_and_ownership")
      next unless options["owned_table"]
      {"sequence" => sequence.fetch("sequence"), "options_sha256" => sequence.fetch("options_sha256"),
       "increment" => options.fetch("seqincrement"),
       "high_water" => sequence.fetch("highwater").fetch(Integer(options.fetch("seqincrement")).positive? ? "maximum" : "minimum")}
    end
  end
end




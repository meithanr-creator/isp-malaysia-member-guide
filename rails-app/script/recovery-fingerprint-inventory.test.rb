require "minitest/autorun"
require_relative "recovery-fingerprint-inventory"

class RecoveryFingerprintInventoryTest < Minitest::Test
  I = RecoveryFingerprintInventory
  class Connection
    attr_reader :statements
    def initialize
      @statements = []
    end
    def transaction_status = 2
    def server_version = 180000
    def quote_ident(value) = '"' + value.gsub('"', '""') + '"'
    def exec(sql)
      @statements << sql
      case sql
      when "SHOW transaction_isolation" then [{"transaction_isolation" => "repeatable read"}]
      when "SHOW transaction_read_only" then [{"transaction_read_only" => "on"}]
      when I::TABLES then %w[schema_migrations users widgets].map { |n| {"schema_name" => "public", "table_name" => n, "relkind" => "r"} }
      when I::ACTORS then [{"id" => "5"}, {"id" => "11"}]
      when I::SEQUENCES then [{"sequence_schema"=>"public","sequence_name"=>"widgets_id_seq","seqincrement"=>"1","seqcache"=>"1","seqcycle"=>"false","seqstart"=>"1","seqmin"=>"1","seqmax"=>"9223372036854775807","owned_schema"=>"public","owned_table"=>"widgets","owned_column"=>"id","dependency_type"=>"a","column_default"=>"nextval('widgets_id_seq'::regclass)"}]
      when I::MFA then [{"id" => "11", "otp_secret" => "encrypted"}]
      when I::IDENTITY then [{"lsn"=>"0/1234","observed_at"=>"2026-10-27T00:00:00Z"}]
      when /SELECT to_jsonb/ then [{"row"=>'{"id":5}'}, {"row"=>'{"id":11}'}]
      when /SELECT last_value/ then [{"last_value"=>"11","is_called"=>"true"}]
      when /SELECT MIN/ then [{"minimum"=>"5","maximum"=>"11","populated_count"=>"2"}]
      else []
      end
    end
  end
  def inventory(conn=Connection.new)
    I.collect(conn, actor_ids:[5,11], binding:{"operation_id"=>"synthetic","lease_id"=>"synthetic","manifest_sha256"=>"a"*64,"prepared_release_sha256"=>"b"*64}, decrypt:->(v) { "A"*24 })
  end
  def test_complete_read_only_sequence_and_dynamic_actor_inventory
    conn = Connection.new
    value = inventory(conn)
    assert_equal 3, value["tables"].length
    assert_equal "11", value["sequences"][0]["highwater"]["maximum"]
    assert_equal "true", value["sequences"][0]["state"]["is_called"]
    assert_equal "11", I.sequence_write_requirements(value)[0]["high_water"]
    assert conn.statements.all? { |sql| sql.start_with?("SELECT", "SHOW") }
    assert_equal "NOT RUN", I.compare!(value, Marshal.load(Marshal.dump(value)))["restore_rollback"]
  end
  def test_every_schema_constraint_index_sequence_state_and_highwater_mismatch_refused
    base=inventory
    %w[tables schema columns constraints indexes types migrations sequences mfa_digests binding].each do |field|
      changed=Marshal.load(Marshal.dump(base))
      changed[field] = {"changed"=>true}
      assert_raises(I::Refused, field) { I.compare!(base, changed) }
    end
    %w[last_value is_called].each do |field|
      changed=Marshal.load(Marshal.dump(base)); changed["sequences"][0]["state"][field]="changed"
      assert_raises(I::Refused) { I.compare!(base,changed) }
    end
    %w[seqincrement seqcache seqcycle column_default dependency_type owned_column].each do |field|
      changed=Marshal.load(Marshal.dump(base));changed["sequences"][0]["options_and_ownership"][field]="changed"
      assert_raises(I::Refused) { I.compare!(base,changed) }
    end
  end
  def test_forward_gap_allowed_but_backward_called_regression_and_cycle_refused
    base=inventory
    forward=Marshal.load(Marshal.dump(base))
    forward["sequences"][0]["state"]["last_value"]="43"
    result=I.compare!(base,forward)
    assert_equal "11",result["sequence_state_compatibility"][0]["baseline_state"]["last_value"]
    assert_equal "43",result["sequence_state_compatibility"][0]["restored_state"]["last_value"]
    assert_equal false,result["sequence_state_compatibility"][0]["actual_generated_ids_verified"]
    assert_equal "NOT RUN",result["restore_rollback"]
    backward=Marshal.load(Marshal.dump(base));backward["sequences"][0]["state"]["last_value"]="10"
    assert_raises(I::Refused) { I.compare!(base,backward) }
    called=Marshal.load(Marshal.dump(base));called["sequences"][0]["state"]["is_called"]="false"
    assert_raises(I::Refused) { I.compare!(base,called) }
    cyclic=Marshal.load(Marshal.dump(base));cyclic["sequences"][0]["options_and_ownership"]["seqcycle"]="true"
    assert_raises(I::Refused) { I.compare!(cyclic,cyclic) }
  end
  def test_descending_and_large_integer_sequence_state_uses_exact_arithmetic
    base=inventory
    seq=base["sequences"][0]
    seq["options_and_ownership"].merge!("seqincrement"=>"-2","seqmin"=>"-9223372036854775808","seqmax"=>"-1")
    seq["state"]={"last_value"=>"-9007199254740993","is_called"=>"true"}
    seq["highwater"]={"minimum"=>"-9007199254740993","maximum"=>"-1","populated_count"=>"2"}
    seq["options_sha256"]=I.digest(seq["options_and_ownership"])
    forward=Marshal.load(Marshal.dump(base));forward["sequences"][0]["state"]["last_value"]="-9007199254741025"
    assert I.compare!(base,forward)["matched"]
    backward=Marshal.load(Marshal.dump(base));backward["sequences"][0]["state"]["last_value"]="-9007199254740991"
    assert_raises(I::Refused) { I.compare!(base,backward) }
    unsafe=Marshal.load(Marshal.dump(base));unsafe["sequences"][0]["highwater"]["minimum"]="-9223372036854775807"
    assert_raises(I::Refused) { I.compare!(unsafe,unsafe) }
  end

  def test_manifest_actor_mismatch_is_not_fixed_nine_actor_check
    assert_raises(I::Refused) { I.collect(Connection.new, actor_ids:[5], binding:{"operation_id"=>"o","lease_id"=>"l","manifest_sha256"=>"m","prepared_release_sha256"=>"r"}, decrypt:->(_) { "A"*24 }) }
  end
  def test_autocommit_and_weak_isolation_refused
    conn=Connection.new
    conn.define_singleton_method(:transaction_status) { 0 }
    assert_raises(I::Refused) { inventory(conn) }
    conn=Connection.new
    conn.define_singleton_method(:exec) { |sql| sql=="SHOW transaction_isolation" ? [{"transaction_isolation"=>"read committed"}] : super(sql) }
    assert_raises(I::Refused) { inventory(conn) }
  end
  def test_decryption_and_readonly_fail_closed
    conn=Connection.new
    conn.define_singleton_method(:exec) { |sql| sql=="SHOW transaction_read_only" ? [{"transaction_read_only"=>"off"}] : super(sql) }
    assert_raises(I::Refused) { inventory(conn) }
    assert_raises(I::Refused) { I.collect(Connection.new,actor_ids:[5,11],binding:{"operation_id"=>"o","lease_id"=>"l","manifest_sha256"=>"m","prepared_release_sha256"=>"r"},decrypt:->(_) { "invalid" }) }
  end
end




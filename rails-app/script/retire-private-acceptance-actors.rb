# One-off operator retirement for the stopped 27 October private acceptance run.
# Normal fixture cleanup and upload-recovery tombstones are deliberately unchanged.
require 'json'
require 'digest'
require 'pg'
require 'time'
class RetirePrivateAcceptanceActors
  BASE = 'D:/Projects/isp-rails-tools/isp-staging-private/private-acceptance'.freeze
  MARKER = 'qa-20261027-913674d20bad'.freeze
  OPERATION = 'a9ab3941-9489-4764-8a09-6a765c0666ae'.freeze
  HOST = 'ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech'.freeze
  PLAN = BASE+'/actor-retirement-plan.json'
  INTENT = BASE+'/actor-retirement-execute-intent.json'
  RESULT = BASE+'/actor-retirement-result.json'
  EMPTY = [Event, Publication, ConsultationRequest, MembershipImport, MembershipRegistryAudit, AdministrativeAudit, EventInterest, ActiveStorage::Attachment, ActiveStorage::VariantRecord].freeze
  def check(value)
    raise 'Owned actor retirement refused' unless value
  end
  def canonical(value) = JSON.generate(value)
  def digest(value) = Digest::SHA256.hexdigest(canonical(value))
  def rows(model) = model.order(:id).map(&:attributes)
  def write_once(path,value)
    check([PLAN,RESULT,INTENT].include?(path) && !File.exist?(path))
    File.open(path,File::WRONLY|File::CREAT|File::EXCL,0o600) do |f|
      f.write(JSON.pretty_generate(value)+"\n");f.flush;f.fsync
    end
  end
  def guard!
    check(Rails.env.production? && ENV['ISP_PRIVATE_ACCEPTANCE']=='true' && ENV['ISP_STAGING_LEASE']=='rails-private-acceptance')
    check(ENV['ISP_ACCEPTANCE_FIXTURES']=='true' && ENV['ISP_ACCEPTANCE_NEON_PROJECT']=='royal-glitter-45740959')
    check(ENV['APP_HOST']=='isp-rails-startup.meithan-r.workers.dev' && ENV['ISP_DEMO_MODE']=='false')
    check(%w[ISP_ACCOUNT_EMAILS_ENABLED ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED].all? { |k| ENV[k]=='false' } && !ActionMailer::Base.perform_deliveries)
    check(File.realpath(BASE).tr('\\','/').downcase==BASE.downcase && !File.symlink?(BASE))
    check(ENV['STORAGE_BUCKET']=='isp-staging-private' && ENV['STORAGE_ENDPOINT']=='https://a9720867333b64a4f8ee70cdfd673eb9.r2.cloudflarestorage.com')
    ActiveRecord::Base.logger=nil
    @db=ApplicationRecord.connection
    check(@db.adapter_name=='PostgreSQL')
    raw=@db.raw_connection
    options=PG::Connection.conninfo_parse(ENV.fetch('DATABASE_URL_UNPOOLED')).to_h { |v| [v[:keyword],v[:val]] }
    check(options['host']==HOST && options['dbname']=='neondb' && options['sslmode']=='verify-full')
    check(%w[hostaddr service options].all? { |k| options[k].to_s.empty? })
    check(raw.host==HOST && raw.db=='neondb' && raw.server_version/10000==18 && raw.ssl_in_use? && raw.conninfo_hash[:sslmode]=='verify-full')
    @db.execute("SET statement_timeout='10s'")
    @db.execute("SET lock_timeout='3s'")
    check(!File.symlink?(BASE+'/acceptance-fixtures.json'))
    @manifest_raw=File.binread(BASE+'/acceptance-fixtures.json')
    @manifest=JSON.parse(@manifest_raw)
    check(@manifest['version']==1 && @manifest['phase']=='active' && @manifest['run_marker']==MARKER && @manifest['lease_id']=='rails-private-acceptance')
    check(@manifest['target']=={'project'=>'royal-glitter-45740959','host'=>HOST,'database'=>'neondb'})
    @actors=@manifest.fetch('actors').values
    @actor_ids=@actors.map { |a| Integer(a.fetch('id')) }.sort
    check(@actor_ids.length==9 && @actor_ids.uniq.length==9)
    @records=@manifest.fetch('records')
    check(@records.fetch('registry').length==7 && @records.fetch('blobs').map { |b| b.fetch('id') }.sort==[2,3])
    check(@manifest.dig('discover','original')==[] && @manifest.dig('discover','expected')==[])
    stopped=JSON.parse(File.read(BASE+'/result.json'))
    check(stopped['shutdown']=='PASS' && stopped.dig('shutdown_facts','application_absent')==true && stopped.dig('shutdown_facts','ingress_closed')==true)
  end
  def ids(kind) = @records.fetch(kind).map { |r| Integer(r.fetch('id')) }.sort
  def verify_blobs!
    check(ActiveStorage::Blob.order(:id).pluck(:id)==[2,3])
    ActiveStorage::Blob.order(:id).each do |blob|
      expected=@records.fetch('blobs').find { |b| b.fetch('id')==blob.id }
      check(blob.key==expected.fetch('key') && blob.filename.to_s==expected.fetch('filename') && blob.filename.to_s.start_with?(MARKER+'-') && blob.service_name=='production_private')
      UploadOperation.verify_owned!(blob,OPERATION)
      ledger=blob.metadata.fetch(UploadOperation::LEDGER)
      check(ledger['state']=='tombstone' && ledger['last_result']=='absence_observed')
      check(blob.metadata['scan_status']=='clean')
    end
    check(EMPTY.all? { |model| !model.exists? })
    check(!DiscoverSlide.exists?)
  end
  def snapshot!
    verify_blobs!
    check(User.order(:id).pluck(:id)==@actor_ids)
    @actors.each do |a|
      u=User.find(a.fetch('id'))
      check(u.email==a.fetch('email') && u.email.start_with?(MARKER+'-') && u.email.end_with?('@staging.planterapp.co') && u.created_at>=Time.iso8601(@manifest.fetch('created_at'))-1)
    end
    {UserSession=>'sessions', AccountToken=>'tokens', AuthenticationChallenge=>'challenges', AccountSecurityEvent=>'security_events', MembershipRegistryEntry=>'registry'}.each do |model,kind|
      check(model.order(:id).pluck(:id)==ids(kind))
      model.all.each do |r|
        if model==AccountSecurityEvent
          references=[r.user_id,r.actor_id].compact
          check(references.any? && references.all? { |v| @actor_ids.include?(v) })
        else
          check(@actor_ids.include?(r.user_id))
        end
      end
    end
    check(canonical(rows(MembershipRegistryState))==canonical(@manifest.fetch('registry_state').fetch('expected')))
    {'users'=>rows(User),'sessions'=>rows(UserSession),'tokens'=>rows(AccountToken),'challenges'=>rows(AuthenticationChallenge),'security_events'=>rows(AccountSecurityEvent),'registry'=>rows(MembershipRegistryEntry),'registry_state'=>rows(MembershipRegistryState),'blobs'=>rows(ActiveStorage::Blob),'throttle'=>rows(LoginAttemptBucket)}
  end
  def postcondition!(plan)
    verify_blobs!
    check([User,UserSession,AccountToken,AuthenticationChallenge,AccountSecurityEvent,MembershipRegistryEntry].all? { |model| !model.exists? })
    check(digest(rows(ActiveStorage::Blob))==plan.fetch('blob_rows_sha256'))
    check(canonical(rows(MembershipRegistryState))==canonical(@manifest.fetch('registry_state').fetch('original')))
    check(digest(rows(LoginAttemptBucket))==plan.fetch('throttle_rows_sha256'))
    check(Digest::SHA256.hexdigest(File.binread(BASE+'/acceptance-fixtures.json'))==plan.fetch('manifest_sha256'))
  end
  def result(plan)
    {version:1,status:'ACTORS_RETIRED_RECOVERY_RETAINED',recorded_at:Time.now.utc.iso8601(6),plan_sha256:Digest::SHA256.file(PLAN).hexdigest,manifest_unchanged:true,retired_actors:9,retired_registry_rows:7,retained_blob_ids:[2,3],retained_blob_rows_sha256:plan.fetch('blob_rows_sha256'),object_writes:0,recovery_calls:0,empty_baseline:false,normal_cleanup_complete:false,production_release_approved:false}
  end
  def run(mode)
    check(%w[plan execute reconcile].include?(mode))
    guard!
    check(!File.symlink?(BASE+'/acceptance-fixtures.json.lock'))
    File.open(BASE+'/acceptance-fixtures.json.lock',File::RDWR|File::CREAT,0o600) do |lock|
      check(!File.symlink?(BASE+'/acceptance-fixtures.json.lock') && lock.flock(File::LOCK_EX|File::LOCK_NB))
      begin
        if mode=='plan'
          ApplicationRecord.transaction do
            @db.execute('SET TRANSACTION READ ONLY')
            snapshot=snapshot!
            plan={version:1,operation:'retire-owned-actors',run_marker:MARKER,upload_operation_id:OPERATION,created_at:Time.now.utc.iso8601(6),manifest_sha256:Digest::SHA256.hexdigest(@manifest_raw),snapshot:snapshot,snapshot_sha256:digest(snapshot),blob_rows_sha256:digest(snapshot.fetch('blobs')),throttle_rows_sha256:digest(snapshot.fetch('throttle')),object_writes:0}
            write_once(PLAN,plan)
          end
          puts JSON.generate(status:'PLAN_SAVED',actors:9,registry:7,recovery_blobs:2,object_writes:0)
        else
          check(!File.symlink?(PLAN) && !File.exist?(RESULT))
          plan=JSON.parse(File.read(PLAN))
          check(plan['version']==1 && plan['operation']=='retire-owned-actors' && plan['run_marker']==MARKER && plan['upload_operation_id']==OPERATION && plan['manifest_sha256']==Digest::SHA256.hexdigest(@manifest_raw))
          if mode=='execute'
            write_once(INTENT,{version:1,plan_sha256:Digest::SHA256.file(PLAN).hexdigest,created_at:Time.now.utc.iso8601(6)})
          else
            check(!File.symlink?(INTENT) && File.exist?(INTENT) && JSON.parse(File.read(INTENT))['plan_sha256']==Digest::SHA256.file(PLAN).hexdigest)
          end
          ApplicationRecord.transaction do
            if mode=='execute'
              names=([User,UserSession,AccountToken,AuthenticationChallenge,AccountSecurityEvent,MembershipRegistryEntry,MembershipRegistryState,ActiveStorage::Blob,LoginAttemptBucket,DiscoverSlide]+EMPTY).map(&:table_name).uniq.sort.map { |n| @db.quote_table_name(n) }.join(',')
              @db.execute('LOCK TABLE '+names+' IN SHARE ROW EXCLUSIVE MODE')
              check(digest(snapshot!)==plan.fetch('snapshot_sha256'))
              UserSession.where(id:ids('sessions'),user_id:@actor_ids).delete_all
              AccountToken.where(id:ids('tokens'),user_id:@actor_ids).delete_all
              AuthenticationChallenge.where(id:ids('challenges'),user_id:@actor_ids).delete_all
              AccountSecurityEvent.where(id:ids('security_events')).delete_all
              MembershipRegistryEntry.where(id:ids('registry'),user_id:@actor_ids).delete_all
              User.where(id:@actor_ids).delete_all
              @manifest.fetch('registry_state').fetch('original').each { |r| MembershipRegistryState.find(r.fetch('id')).update_columns(r.except('id')) }
            else
              @db.execute('SET TRANSACTION READ ONLY')
            end
            postcondition!(plan)
          end
          receipt=result(plan)
          write_once(RESULT,receipt)
          puts JSON.generate(receipt)
        end
      ensure
        lock.flock(File::LOCK_UN)
      end
    end
  end
end
begin
  RetirePrivateAcceptanceActors.new.run(ARGV.fetch(0))
rescue StandardError => error
  File.open(RetirePrivateAcceptanceActors::BASE+'/actor-retirement-last-error.txt','w',0o600) { |f| f.write("#{error.class}: #{error.message}\n#{Array(error.backtrace).first(8).join("\n")}") }
  warn 'Owned actor retirement stopped; inspect its private evidence before continuing.'
  exit 1
end
namespace :membership_imports do
  desc "Erase expired normalized membership preview rows (no raw CSV is stored)"
  task expire: :environment do
    count = MembershipImport.expire_previews!
    puts "Expired membership previews cleared: #{count}"
  end
end

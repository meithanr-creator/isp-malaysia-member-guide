namespace :identity do
  desc "Dispatch a bounded batch of authorized account recovery emails (disabled by default)"
  task dispatch_account_email: :environment do
    result = AccountEmailDispatcher.call
    abort "Account email dispatcher is disabled; no email was sent." unless result.enabled?
    puts "Account email batch: #{result.sent} sent, #{result.failed} failed."
  end
end

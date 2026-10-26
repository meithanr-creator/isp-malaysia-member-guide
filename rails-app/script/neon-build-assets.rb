# Invoke the real production asset task with its output isolated from live previews.
require_relative "../config/application"
require "rake"

Rails.application.config.assets.output_path = Rails.root.join("tmp/neon-build/assets")
Rails.application.config.assets.manifest_path = Rails.application.config.assets.output_path.join(".manifest.json")
Rake.application.init("rake", ["assets:precompile"])
Rails.application.load_tasks
Rake.application.top_level

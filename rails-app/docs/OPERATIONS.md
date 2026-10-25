# Local Rails review and future hosting

The local Windows runtime is Ruby 3.4.12 and Rails 8.1.4, installed entirely under D:\Projects\isp-rails-tools. The project is D:\Projects\isp-member-rails. Generated project secrets, logs, database and uploads stay local and are excluded from source publication.

From PowerShell in the project directory, use `& .\script\rails.ps1 db:prepare` to prepare the database and `& .\script\rails.ps1 -RailsArguments @('server', '--binding=127.0.0.1', '--port=4180')` to start the local server. Use `& .\script\rails.ps1 test` for the independent test suite. The helper sets Ruby/gem/temp paths on D for that process only. Passing server arguments as an array avoids PowerShell interpreting Rails' short `-p` option as a PowerShell parameter.

The localhost address works on this computer while the server runs. It is not a third-party review URL. The existing static Cloudflare demonstration remains a separate reference.

## Hosting decision

Choose a Rails-compatible container/process host at the hosted-release milestone. Use PostgreSQL, private object storage and a supported mail/scan background process. Cloudflare may provide DNS/proxy and caching for approved public assets. Cloudflare Pages' static hosting cannot execute the Rails server. Do not cache authenticated HTML or API responses.

Configure production secrets in the host secret manager. Never enable sample-login shortcuts or ship seeded review accounts to production. Complete M2b and the production release checklist first. No new paid hosting or production database has been provisioned for this local page review.

## Tooling provenance

Official RubyInstaller 3.4.12-1 x64 portable archive SHA256: 3806f164377824bcb17e1cf39b17d967e2bdc01e8547ce0254cd786dbe2cfe13.

Official RubyInstaller Devkit 3.4.12-1 x64 installer SHA256: b6ff4e338f47d26fe3f038fc5591f2190677b9b69747a77e9c76a067aa5f2da2.

Downloads were checked against publisher GitHub release digests before execution. The Devkit installer used a D-drive destination and temporary/log paths, with no PATH/file-association tasks selected. An earlier WSL Ubuntu startup failed RPC; no WSL system repair was attempted.

The optional image-processing library's Windows package setup emitted missing package-keyring warnings. Do not claim image transformation/scanning capability from that installation; use validated original files for local preview until production image processing is configured and tested.

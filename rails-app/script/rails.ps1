param([Parameter(ValueFromRemainingArguments=$true)][string[]]$RailsArguments)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$toolRoot=Join-Path (Split-Path $projectRoot -Parent) 'isp-rails-tools'
$rubyBin=Join-Path $toolRoot 'ruby34-devkit\bin'
$env:GEM_HOME=Join-Path $toolRoot 'gems'
$env:GEM_PATH=$env:GEM_HOME
$env:BUNDLE_USER_HOME=Join-Path $toolRoot 'bundle-home'
$env:TEMP=Join-Path $toolRoot 'tmp'
$env:TMP=$env:TEMP
$env:PATH="$rubyBin;$env:GEM_HOME\bin;$env:PATH"
Push-Location $projectRoot
try { & (Join-Path $rubyBin 'ruby.exe') 'bin/rails' @RailsArguments; exit $LASTEXITCODE }
finally { Pop-Location }

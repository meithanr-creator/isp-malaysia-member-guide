$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path $PSScriptRoot -Parent
try {
  $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4180/up' -UseBasicParsing -TimeoutSec 2
  if ($response.StatusCode -eq 200) { exit 0 }
} catch { }
& (Join-Path $PSScriptRoot 'rails.ps1') -RailsArguments @('server', '--binding=127.0.0.1', '--port=4180') *> (Join-Path $previewRoot 'log\preview-console.log')
param([string]$Destination='D:\Projects\isp-rails-tools\isp-staging-private\deployment-token.json')
$ErrorActionPreference='Stop'
try {
  Write-Host 'ISP deployment key — private input'
  Write-Host 'Paste only the new ISP production-readiness deployment token. Input is hidden.'
  $secure=Read-Host 'API token' -AsSecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
  if($token.Length -lt 32 -or $token -match '\s') {throw 'Incomplete credential'}
  $data=@{CLOUDFLARE_API_TOKEN=$token;saved_at=[DateTimeOffset]::UtcNow.ToString('o')}
  [IO.File]::WriteAllText($Destination,($data|ConvertTo-Json))
  $token=$null;$data=$null
  Write-Host 'Saved in the restricted staging folder on drive D. No token was printed.'
  Read-Host 'Return to the chat and reply Deployment key ready; press Enter to close'|Out-Null
} catch {Write-Host 'Capture did not complete; no secret values are displayed.';Read-Host 'Press Enter to close'|Out-Null;exit 1}
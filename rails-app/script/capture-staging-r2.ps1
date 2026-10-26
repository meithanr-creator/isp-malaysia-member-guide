param([string]$Destination='D:\Projects\isp-rails-tools\isp-staging-private\r2.json')
$ErrorActionPreference='Stop'
function Read-PrivateValue([string]$Label) {
  $value=Read-Host -Prompt $Label -AsSecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
try {
  Write-Host 'ISP staging storage credentials'
  Write-Host 'Use only the new Object Read & Write token for isp-staging-private.'
  Write-Host 'Paste the S3 Access Key ID and Secret Access Key below. Input is hidden.'
  Write-Host 'Do not paste the separate Cloudflare API Token value.'
  $access=Read-PrivateValue 'S3 Access Key ID'
  $secret=Read-PrivateValue 'S3 Secret Access Key'
  if($access.Length -lt 16 -or $secret.Length -lt 32 -or $access -match '\s' -or $secret -match '\s') { throw 'Credential format looks incomplete. No file was written.' }
  $data=@{AWS_ACCESS_KEY_ID=$access;AWS_SECRET_ACCESS_KEY=$secret;STORAGE_BUCKET='isp-staging-private';saved_at=[DateTimeOffset]::UtcNow.ToString('o')}
  [IO.File]::WriteAllText($Destination,($data|ConvertTo-Json))
  $access=$null;$secret=$null;$data=$null
  Write-Host 'Saved to the private staging folder on drive D. No credentials were printed.'
  Read-Host 'Return to the chat and reply Storage key ready; press Enter to close' | Out-Null
} catch {
  Write-Host 'The credential capture did not complete. No secret values are displayed.'
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}
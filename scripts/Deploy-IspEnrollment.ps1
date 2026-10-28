param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\Use-IspEnvironment.ps1"
if ((Resolve-Path .).Path -ne 'D:\Projects\isp-firebase') { throw 'Wrong ISP workspace' }
if ((& git rev-parse HEAD).Trim() -ne $SourceCommit) { throw 'Published checkpoint must match the local source checkpoint' }
$ispExpected=@{
 'functions/src/enrollment.ts'='bb34ca30a65feeaf4e853b1f85697f3e14bb646a3de1e803d3107a0181856384'
 'functions/src/index.ts'='3a289bc66054185c5d369a5e1bfe9fdb2cc0a30d5e933d8ab1b3c896678fb360'
 'functions/src/registry.ts'='7db7e2b97b50103d698c4a9abd612f5f6f66af22aec998dcf6d1f0144da32af1'
 'functions/src/validation.ts'='498496d509326203d325e632ceaf75c1591ef82ba85c69c3fc379d0df87ab88f'
}
foreach($ispPath in $ispExpected.Keys) { if((Get-FileHash $ispPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ispExpected[$ispPath]){throw "Unreviewed source delta: $ispPath"} }
$ispInputs=@('functions/src','functions/package.json','functions/package-lock.json','functions/tsconfig.json','firebase.json')
& git diff --exit-code $SourceCommit -- @ispInputs | Out-Null
if($LASTEXITCODE -ne 0){throw 'Deployment inputs differ from reviewed source checkpoint'}
if(@(& git ls-files --others --exclude-standard -- functions/src).Count){throw 'Untracked deployment source refused'}
if((Get-Content functions/.env.isp-planter-app -Raw).Trim() -ne ('ISP_SOURCE_COMMIT='+$SourceCommit)){throw 'Runtime source version differs from checkpoint'}
$ispLock=[IO.File]::Open('D:\Projects\isp-firebase-tools\provider-build.lock',[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
function Invoke-IspObservedCommand([string[]]$Arguments,[int]$Seconds=20) {
 $ispToken=[guid]::NewGuid().ToString('N')
 $ispOut="D:\Projects\isp-firebase-tools\tmp\observed-$ispToken.out"
 $ispErr="D:\Projects\isp-firebase-tools\tmp\observed-$ispToken.err"
 $ispCmd=Start-Process -FilePath $ispGcloud -ArgumentList $Arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $ispOut -RedirectStandardError $ispErr
 if(!$ispCmd.WaitForExit($Seconds*1000)){$ispCmd.Kill($true);throw 'Provider observation timed out; status UNKNOWN'}
 if($ispCmd.ExitCode -ne 0){throw 'Provider command failed; see private D observation logs'}
 return Get-Content -LiteralPath $ispOut -Raw
}
function Get-IspBuildRows([int]$Seconds=20) {
 $ispJson=Invoke-IspObservedCommand -Arguments @('builds','list','--project=isp-planter-app','--region=asia-southeast1','--limit=100','--format=json','--quiet') -Seconds $Seconds
 return @($ispJson|ConvertFrom-Json)
}
function Test-IspOwnedBuild($Build) {
 $ispTarget=$Build.substitutions._GOOGLE_FUNCTION_TARGET
 $ispSource=$Build.substitutions._GOOGLE_LABEL_SOURCE
 return ($ispTarget -in $ispNames -and 'p-gcf' -in $Build.tags -and ('service_'+$ispTarget.ToLowerInvariant()) -in $Build.tags -and $ispSource -match ('^gs://gcf-v2-sources-606528057827-asia-southeast1/'+[regex]::Escape($ispTarget)+'/function-source\.zip#[0-9]+$') -and $Build.serviceAccount -eq 'projects/isp-planter-app/serviceAccounts/606528057827-compute@developer.gserviceaccount.com')
}
$ispNames=@('activateMyMembership','previewRegistryImport','getRegistryImportPreview','confirmRegistryImport')
$ispSelector=($ispNames | ForEach-Object { 'functions:isp-core:'+$_ }) -join ','
$ispStarted=[DateTimeOffset]::UtcNow
$ispAudit='D:\Projects\isp-firebase\audit'
$ispInitial=Get-IspBuildRows
if(@($ispInitial|Where-Object{$_.status -in @('PENDING','QUEUED','WORKING')}).Count){$ispLock.Dispose();throw 'Another ISP build is active; not started'}
$ispBaseline=@($ispInitial|ForEach-Object{$_.id})
$ispOwned=@{}
$ispFailed=$false
$ispObservationSealed=$false
$ispUnknown=@()
$ispExit=1
$ispProcess=Start-Process -FilePath $ispNode -ArgumentList @($ispFirebase,'deploy','--only',$ispSelector,'--project','isp-planter-app','--non-interactive') -WorkingDirectory 'D:\Projects\isp-firebase' -WindowStyle Hidden -PassThru -RedirectStandardOutput "$ispAudit\enrollment-deploy.stdout.log" -RedirectStandardError "$ispAudit\enrollment-deploy.stderr.log"
try {
 while(!$ispProcess.HasExited) {
  $ispActiveLeft=[int][math]::Floor(660-([DateTimeOffset]::UtcNow-$ispStarted).TotalSeconds)
  if($ispActiveLeft -lt 1){throw 'Active deployment deadline reached'}
  foreach($ispBuild in (Get-IspBuildRows -Seconds ([math]::Min(20,$ispActiveLeft)))) {
   if($ispBuild.id -notin $ispBaseline -and [DateTimeOffset]$ispBuild.createTime -ge $ispStarted.AddSeconds(-5)) {
    if(Test-IspOwnedBuild $ispBuild){$ispOwned[$ispBuild.id]=$ispBuild}else{throw 'Unrelated new build observed; leave it untouched and stop ISP release'}
   }
  }
  if($ispOwned.Count -gt 4 -or ([DateTimeOffset]::UtcNow-$ispStarted).TotalSeconds -ge 660){throw 'Owned deployment cutoff; no automatic retry'}
  Start-Sleep -Seconds 5
  $ispProcess.Refresh()
 }
 $ispProcess.WaitForExit()
 $ispExit=$ispProcess.ExitCode
 if($ispExit -ne 0){$ispFailed=$true}
} catch {
 $ispFailed=$true
 if(!$ispProcess.HasExited){$ispProcess.Kill($true)}
 Write-Output $_.Exception.Message
} finally {
 $ispFinalDeadline=$ispStarted.AddSeconds(720)
 function Get-IspFinalSeconds([int]$Maximum=10){[int][math]::Max(0,[math]::Min($Maximum,[math]::Floor(($ispFinalDeadline-[DateTimeOffset]::UtcNow).TotalSeconds)))}
 try {
  $ispRemaining=Get-IspFinalSeconds
  if($ispRemaining -lt 1){throw 'Final observation deadline reached'}
  foreach($ispBuild in (Get-IspBuildRows -Seconds $ispRemaining)){if($ispBuild.id -notin $ispBaseline -and [DateTimeOffset]$ispBuild.createTime -ge $ispStarted.AddSeconds(-5) -and (Test-IspOwnedBuild $ispBuild)){$ispOwned[$ispBuild.id]=$ispBuild}}
 } catch {$ispFailed=$true;$ispUnknown=@($ispOwned.Keys);Write-Output $_.Exception.Message}
 if($ispFailed){
  foreach($ispBuild in $ispOwned.Values){
   if($ispBuild.status -in @('PENDING','QUEUED','WORKING')){
    try {
     $ispRemaining=Get-IspFinalSeconds
     if($ispRemaining -lt 1){throw 'Cancellation deadline reached; build status UNKNOWN'}
     Invoke-IspObservedCommand -Arguments @('builds','cancel',$ispBuild.id,'--project=isp-planter-app','--region=asia-southeast1','--quiet') -Seconds $ispRemaining | Out-Null
    } catch {$ispUnknown+=@($ispBuild.id);Write-Output $_.Exception.Message}
   }
  }
 }
 try {
  $ispRemaining=Get-IspFinalSeconds
  if($ispRemaining -lt 1){throw 'Final readback deadline reached'}
  foreach($ispBuild in (Get-IspBuildRows -Seconds $ispRemaining)){if($ispOwned.ContainsKey($ispBuild.id)){$ispOwned[$ispBuild.id]=$ispBuild}}
  $ispUnknown=@($ispOwned.Values|Where-Object{$_.status -in @('PENDING','QUEUED','WORKING')}|ForEach-Object{$_.id})
  $ispObservationSealed=($ispUnknown.Count -eq 0)
 } catch {$ispUnknown=@($ispOwned.Keys);$ispObservationSealed=$false;Write-Output $_.Exception.Message}
 if(!$ispObservationSealed -or $ispFailed){$ispExit=1;$ispFailed=$true}
 $ispLock.Dispose()
 $ispRows=@($ispOwned.Values|ForEach-Object{[ordered]@{id=$_.id;status=$_.status;startTime=$_.startTime;finishTime=$_.finishTime}})
 [ordered]@{project='isp-planter-app';sourceCommit=$SourceCommit;selectedFunctions=$ispNames;startedAt=$ispStarted.ToString('o');finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$ispExit;failed=$ispFailed;builds=$ispRows;automaticRetry=$false;observationSealed=$ispObservationSealed;unknownBuildIds=$ispUnknown;oldCoreChecksReplayed=$false} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$ispAudit\enrollment-deployment.json"
}
Write-Output "Targeted member onboarding deployment exit: $ispExit; owned builds: $($ispOwned.Count)"
exit $ispExit




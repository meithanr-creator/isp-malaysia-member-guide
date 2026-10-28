$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Read-ISPControllerRows($rows) {
  if($rows.Count -lt 1 -or $rows.Count -gt 8192){throw 'Incomplete process census'}
  $result=@()
  $seen=@{}
  foreach($row in $rows){
    if($null -eq $row -or $null -eq $row.ProcessId -or -not $row.Name -or [long]$row.ProcessId -lt 0 -or $seen.ContainsKey([long]$row.ProcessId)){throw 'Malformed process census row'}
    $seen[[long]$row.ProcessId]=$true
    if([string]$row.Name -ine 'node.exe'){continue}
    if(-not $row.ProcessId -or -not $row.ExecutablePath -or -not $row.CommandLine -or -not $row.CreationDate){throw 'Unknown Node process identity'}
    $line=[string]$row.CommandLine
    $match=[regex]::Match($line,'(?s)^\s*(?:"[^"]+"|[^\s"]+)\s+(?:"(?<script>[^"]+)"|(?<script>[^\s"]+))(?<tail>.*)$')
    if(-not $match.Success){throw 'Unknown Node command'}
    $script=$match.Groups['script'].Value.Replace('\','/').ToLowerInvariant()
    $tail=$match.Groups['tail'].Value.Trim()
    $kind=''
    $controllerReference=$line -match '(?i)(?:lease2-provision|cloudflare-staging-watchdog|cloudflare-staging-ops)\.mjs\b'
    if($script.StartsWith('-')){if($controllerReference){$kind='other'}else{continue}}
    $name=($script -split '/')[-1]
    if($name -eq 'lease2-provision.mjs'){$kind='provision'}
    elseif($name -eq 'cloudflare-staging-watchdog.mjs'){$kind='watchdog'}
    elseif($name -eq 'cloudflare-staging-ops.mjs'){$kind='other'}
    elseif($script.StartsWith('-') -and $controllerReference){$kind='other'}
    if(-not $kind){continue}
    $exe=([string]$row.ExecutablePath).Replace('\','/').ToLowerInvariant()
    $fixed=$exe -eq 'd:/projects/isp-rails-tools/node24/node.exe' -and $script -eq ('d:/projects/isp-member-rails/script/'+$name)
    $mode=if($tail -cmatch '^--[a-z-]+$'){$tail}else{'unknown'}
    $created=([datetime]$row.CreationDate).ToUniversalTime().ToString('o')
    $result+=@{pid=[long]$row.ProcessId;kind=$kind;fixed_identity=[bool]$fixed;mode=$mode;created_at=$created}
  }
  return $result
}
$script:checks=0
function Check($ok){if(-not $ok){throw ("Native classifier assertion failed at "+$script:checks)};$script:checks++}
function Refuses($work){try{& $work}catch{$script:checks++;return};throw 'Expected native classifier refusal'}
function Row($pidValue,$cmd,$exe='D:\Projects\isp-rails-tools\node24\node.exe',$name='node.exe'){@{ProcessId=$pidValue;CommandLine=$cmd;ExecutablePath=$exe;Name=$name;CreationDate=[datetime]'2026-10-27T04:00:00Z'}}
$own=Row 123 '"D:\Projects\isp-rails-tools\node24\node.exe" "D:\Projects\isp-member-rails\script\lease2-provision.mjs" --preflight'
$watch=Row 125 'D:/Projects/isp-rails-tools/node24/node.exe D:/Projects/isp-member-rails/script/cloudflare-staging-watchdog.mjs --arm'
$diagnostic=Row 126 'node.exe -e "console.log(''unrelated inline diagnostic'')"'
$shell=Row 127 'powershell.exe -Command "literal lease2-provision.mjs cloudflare-staging-watchdog.mjs"' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' 'powershell.exe'
$test=Row 128 'node.exe --test script/lease2-provision-core.test.mjs'
$rows=@(Read-ISPControllerRows @($own,$watch,$diagnostic,$shell,$test))
Check ($rows.Count -eq 2)
Check ($rows[0].pid -eq 123 -and $rows[0].kind -ceq 'provision' -and $rows[0].fixed_identity -eq $true -and $rows[0].mode -ceq '--preflight')
Check ($rows[1].pid -eq 125 -and $rows[1].kind -ceq 'watchdog' -and $rows[1].fixed_identity -eq $true -and $rows[1].mode -ceq '--arm')
Check (-not (($rows|ConvertTo-Json -Compress) -match 'CommandLine|console.log|literal'))
$relative=Row 130 'node.exe script/lease2-provision.mjs --provision'
$r=@(Read-ISPControllerRows @($relative));Check ($r.Count -eq 1 -and -not $r[0].fixed_identity)
$foreign=Row 131 'node.exe D:/Projects/isp-member-rails/script/lease2-provision.mjs --provision' 'D:\foreign\node.exe'
$r=@(Read-ISPControllerRows @($foreign));Check ($r.Count -eq 1 -and -not $r[0].fixed_identity)
$extra=Row 132 'node.exe D:/Projects/isp-member-rails/script/cloudflare-staging-watchdog.mjs --arm --stop-now'
$r=@(Read-ISPControllerRows @($extra));Check ($r.Count -eq 1 -and $r[0].mode -ceq 'unknown')
$flag=Row 133 'node.exe --require bootstrap.js D:/Projects/isp-member-rails/script/lease2-provision.mjs --provision'
$r=@(Read-ISPControllerRows @($flag));Check ($r.Count -eq 1 -and $r[0].kind -ceq 'other' -and -not $r[0].fixed_identity)
$case=Row 134 'node.exe D:/Projects/isp-member-rails/script/cloudflare-staging-watchdog.mjs --ARM'
$r=@(Read-ISPControllerRows @($case));Check ($r.Count -eq 1 -and $r[0].mode -ceq 'unknown')
$evalController=Row 140 'node.exe --eval "process.argv=[1,2,\"--arm\"];import(\"D:/Projects/isp-member-rails/script/cloudflare-staging-watchdog.mjs\")"'
$r=@(Read-ISPControllerRows @($evalController));Check ($r.Count -eq 1 -and $r[0].kind -ceq 'other' -and -not $r[0].fixed_identity)
$equalsEval=Row 143 'node.exe --eval=import(''./script/cloudflare-staging-watchdog.mjs'')'
$r=@(Read-ISPControllerRows @($equalsEval));Check ($r.Count -eq 1 -and $r[0].kind -ceq 'other' -and -not $r[0].fixed_identity)
$equalsPrint=Row 144 'node.exe --print=import(''D:/Projects/isp-member-rails/script/lease2-provision.mjs'')'
$r=@(Read-ISPControllerRows @($equalsPrint));Check ($r.Count -eq 1 -and $r[0].kind -ceq 'other' -and -not $r[0].fixed_identity)
$namedInline=Row 142 'node.exe -e "console.log(''lease2-provision.mjs'')"'
$r=@(Read-ISPControllerRows @($namedInline));Check ($r.Count -eq 1 -and $r[0].kind -ceq 'other' -and -not $r[0].fixed_identity)
$relativeEval=Row 141 'node.exe -e "import(''./script/lease2-provision.mjs'')"'
$r=@(Read-ISPControllerRows @($relativeEval));Check ($r.Count -eq 1 -and $r[0].kind -ceq 'other' -and -not $r[0].fixed_identity)
$missingCmd=Row 135 $null
Refuses {Read-ISPControllerRows @($missingCmd)}
$badExe=Row 136 'node.exe script/other.mjs' $null
Refuses {Read-ISPControllerRows @($badExe)}
Refuses {Read-ISPControllerRows @()}
Refuses {Read-ISPControllerRows @($own,$own)}
Refuses {Read-ISPControllerRows @($null)}
Refuses {Read-ISPControllerRows (@($own)*8193)}

foreach($ending in @([string][char]10,([string][char]13+[string][char]10))){
  $unrelated=Row 200 ('node.exe --eval "const value=1;'+$ending+'console.log(value)"')
  $r=@(Read-ISPControllerRows @($unrelated));Check ($r.Count -eq 0)
  $unrelatedTest=Row 201 ('node.exe --test "'+$ending+'script/unrelated.test.mjs"')
  $r=@(Read-ISPControllerRows @($unrelatedTest));Check ($r.Count -eq 0)
  foreach($flag in @('-e','--eval=','--test')){
    $space=if($flag.EndsWith('=')){''}else{' '}
    $wrapped=Row 202 ('node.exe '+$flag+$space+'"const value=1;'+$ending+'import(''D:/Projects/isp-member-rails/script/cloudflare-staging-watchdog.mjs'')'+$ending+'"')
    $r=@(Read-ISPControllerRows @($wrapped));Check ($r.Count -eq 1 -and $r[0].kind -ceq 'other' -and -not $r[0].fixed_identity)
  }
}
$tabbed=Row 203 ('node.exe'+[char]9+'D:/Projects/isp-member-rails/script/lease2-provision.mjs'+[char]9+'--preflight')
$r=@(Read-ISPControllerRows @($tabbed));Check ($r.Count -eq 1 -and $r[0].fixed_identity -and $r[0].mode -ceq '--preflight')
$extraLine=Row 204 ('node.exe D:/Projects/isp-member-rails/script/cloudflare-staging-watchdog.mjs --arm'+[char]10+'--stop-now')
$r=@(Read-ISPControllerRows @($extraLine));Check ($r.Count -eq 1 -and $r[0].mode -ceq 'unknown')
$single=Row 205 'node.exe'
Refuses {Read-ISPControllerRows @($single)}
@{status='PASS';assertions=$script:checks;os_census_calls=0;network_requests=0;secret_reads=0}|ConvertTo-Json -Compress

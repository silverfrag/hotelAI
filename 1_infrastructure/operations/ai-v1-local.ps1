param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('start','stop','status','build','backup','infra')][string]$Action
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtime = Join-Path $root '.tmp/ai-v1-local'
$composeFile = Join-Path $PSScriptRoot 'compose.ai-v1.yml'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$secretFile = Join-Path $runtime 'secrets.json'
if (-not (Test-Path -LiteralPath $secretFile)) {
    # Demo-only secrets stay outside Git and evidence. Never load the root .env.
    @{password=[guid]::NewGuid().ToString('N');jwt=([guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N'))} |
        ConvertTo-Json | Set-Content -LiteralPath $secretFile -Encoding utf8
}
$secrets = Get-Content -LiteralPath $secretFile -Raw | ConvertFrom-Json
$env:AI_V1_DB_PASSWORD = $secrets.password
$stateFile = Join-Path $runtime 'processes.json'
$owned = @()
if (Test-Path -LiteralPath $stateFile) { $owned = @(Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json) }
function Invoke-Compose([string[]]$Arguments) {
    & docker compose --env-file (Join-Path $runtime 'empty.env') -f $composeFile @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Demo Compose failed ($LASTEXITCODE)" }
}
if (-not (Test-Path -LiteralPath (Join-Path $runtime 'empty.env'))) {
    Set-Content -LiteralPath (Join-Path $runtime 'empty.env') -Value '# Intentionally empty' -Encoding ascii
}
function Memory-Sample {
    $os = Get-CimInstance Win32_OperatingSystem
    $sample = @{time=(Get-Date).ToUniversalTime().ToString('o');available_gib=$os.FreePhysicalMemory/1MB;phase=$Action}
    $sample | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $runtime 'memory.jsonl')
    return $sample
}
function Require-Headroom {
    $sample = Memory-Sample
    if ($sample.available_gib -lt 1.5) { throw "M0 memory gate: $([math]::Round($sample.available_gib,2)) GiB available, requires 1.5 GiB. No further services started." }
}
function Is-Owned($entry) {
    $p = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    return $p -and ($p.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.started_ticks) -and ($p.Path -eq $entry.path)
}
function Start-Owned([string]$Name,[string]$Exe,[string[]]$Arguments,[string]$Directory,[hashtable]$Variables) {
    $existing = @($script:owned | Where-Object name -eq $Name)
    if ($existing.Count -and (Is-Owned $existing[0])) { return }
    $port = @{ollama=11435;ai=58220;backend=53223;frontend=53224}[$Name]
    if($port -and (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
        throw "Port $port is occupied by a process not owned by this launcher"
    }
    Require-Headroom
    $previous = @{}
    try {
        foreach($key in $Variables.Keys) { $previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process'); [Environment]::SetEnvironmentVariable($key,$Variables[$key],'Process') }
        $p = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $runtime "$Name.out.log") -RedirectStandardError (Join-Path $runtime "$Name.err.log")
        $entry = @{name=$Name;pid=$p.Id;started_ticks=$p.StartTime.ToUniversalTime().Ticks.ToString();path=[IO.Path]::GetFullPath($Exe)}
        $script:owned = @($script:owned | Where-Object name -ne $Name) + @($entry)
        ConvertTo-Json -InputObject @($script:owned) -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding utf8
    } finally { foreach($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') } }
}
function Wait-Http([string]$Url,[int]$Seconds=90) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try { $response=Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing; if($response.StatusCode -eq 200){return} } catch {}
        Start-Sleep -Seconds 2
    } while((Get-Date) -lt $deadline)
    throw "Health timeout: $Url; inspect .tmp/ai-v1-local logs"
}
if($Action -eq 'stop') {
    foreach($entry in @($owned | Sort-Object name -Descending)) {
        if(Is-Owned $entry) { & taskkill.exe /PID $entry.pid /T /F | Out-Null; if($LASTEXITCODE -ne 0){throw 'Could not stop owned process'} }
    }
    Invoke-Compose @('stop')
    return
}
if($Action -eq 'status') {
    Invoke-Compose @('ps','--all')
    $processes = @(foreach($entry in $owned){ [pscustomobject]@{service=$entry.name;pid=$entry.pid;owned_running=[bool](Is-Owned $entry)} })
    $health = @(foreach($url in @('http://127.0.0.1:11435/api/tags','http://127.0.0.1:58220/health/live','http://127.0.0.1:53223/api/v1/core/health/ready','http://127.0.0.1:53224/api/health')) {
        try { $r=Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing; [pscustomobject]@{url=$url;http=$r.StatusCode;body=($r.Content | ConvertFrom-Json)} }
        catch { [pscustomobject]@{url=$url;http='unavailable'} }
    })
    $report = @{measured_at=(Get-Date).ToUniversalTime().ToString('o');processes=$processes;health=$health;memory=(Memory-Sample);conversion_ready=$false;qwen_runtime_frozen=$false}
    $json = $report | ConvertTo-Json -Depth 10
    $json | Set-Content -LiteralPath (Join-Path $runtime 'status.json') -Encoding utf8
    Write-Output $json
    if(@($health | Where-Object http -ne 200).Count){exit 3}
    return
}
if($Action -eq 'build') {
    Require-Headroom
    Push-Location (Join-Path $root '3_backend_core')
    try { & node node_modules/@nestjs/cli/bin/nest.js build; if($LASTEXITCODE -ne 0){throw 'Backend build failed'} } finally { Pop-Location }
    Require-Headroom
    Push-Location (Join-Path $root '4_frontend_nextjs')
    $oldBuild=$env:HOTELAI_VALIDATION_BUILD
    try { $env:HOTELAI_VALIDATION_BUILD='local-ai'; & node node_modules/next/dist/bin/next build; if($LASTEXITCODE -ne 0){throw 'Frontend build failed'} }
    finally { $env:HOTELAI_VALIDATION_BUILD=$oldBuild; Pop-Location }
    return
}
if($Action -eq 'backup') {
    # pg_dump writes inside the demo container; docker cp preserves binary bytes in PS 5/7.
    $suffix=Get-Date -Format 'yyyyMMddHHmmss'
    $target="hotelai_ai_v1_restore_$suffix"
    Invoke-Compose @('exec','-T','postgres','pg_dump','-Fc','--no-owner','--no-privileges','-U','ai_v1_demo','-d','hotelai_ai_v1_demo','-f',"/tmp/ai-v1-$suffix.dump")
    Invoke-Compose @('cp',"postgres:/tmp/ai-v1-$suffix.dump",(Join-Path $runtime "ai-v1-$suffix.dump"))
    Invoke-Compose @('exec','-T','postgres','createdb','-U','ai_v1_demo',$target)
    Invoke-Compose @('exec','-T','postgres','pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','ai_v1_demo','-d',$target,"/tmp/ai-v1-$suffix.dump")
    & node (Join-Path $PSScriptRoot 'ai-v1-verify-restore.mjs') $target "ai-v1-$suffix.dump"
    if($LASTEXITCODE -ne 0){throw 'Restore comparison failed; demo source was preserved'}
    return
}
Require-Headroom
Invoke-Compose @('up','-d','--wait','--wait-timeout','180')
Require-Headroom
if($Action -eq 'infra'){Memory-Sample;return}
# Existing migrations are applied ONLY to the new demo DB; never edit their SQL here.
$dbVariables=@{DB_HOST='127.0.0.1';DB_PORT='55321';DB_USER='ai_v1_demo';DB_PASSWORD=$secrets.password;DB_NAME='hotelai_ai_v1_demo'}
$previous=@{}
try {
    foreach($key in $dbVariables.Keys){$previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process');[Environment]::SetEnvironmentVariable($key,$dbVariables[$key],'Process')}
    & node (Join-Path $PSScriptRoot 'migrate.mjs') --apply
    if($LASTEXITCODE -ne 0){throw 'Demo migration failed; old SQL was not modified'}
} finally {foreach($key in $previous.Keys){[Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')}}
$ollama=Join-Path $root '.tmp/local-ai/ollama-v0.40.12/ollama.exe'
Start-Owned 'ollama' $ollama @('serve') $root @{OLLAMA_HOST='127.0.0.1:11435';OLLAMA_MODELS=(Join-Path $root '.tmp/local-ai/models');OLLAMA_NO_CLOUD='1';OLLAMA_NUM_PARALLEL='1';OLLAMA_MAX_LOADED_MODELS='1'}
Wait-Http 'http://127.0.0.1:11435/api/tags'
Start-Owned 'ai' (Join-Path $root '2_ai_pricing_service/.venv/Scripts/python.exe') @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','58220') (Join-Path $root '2_ai_pricing_service') @{
    MARKET_CONTEXT_PROVIDER='ollama';MARKET_CONTEXT_MODEL='qwen3:1.7b';MARKET_CONTEXT_OLLAMA_URL='http://127.0.0.1:11435/api/chat';OMP_NUM_THREADS='1';OPENBLAS_NUM_THREADS='1'
    MODEL_PATH=(Join-Path $runtime 'no-operational-price-model.pkl');CONVERSION_MODEL_PATH=(Join-Path $runtime 'no-operational-conversion-model.pkl')
}
Wait-Http 'http://127.0.0.1:58220/health/live'
$backendEnv=$dbVariables.Clone()
$backendEnv += @{PORT='53223';JWT_SECRET=$secrets.jwt;DEPLOYMENT_MODE='development';NODE_ENV='production';HOTEL_TIMEZONE='Asia/Bangkok';COOKIE_SECURE='false';CORS_ORIGINS='http://127.0.0.1:53224';AI_SERVICE_URL='http://127.0.0.1:58220/api/v1/predict-price';AI_SHADOW_OPTIMIZER_URL='http://127.0.0.1:58220/api/v1/optimize-price-shadow';AI_SERVICE_TIMEOUT_MS='750';AI_SHADOW_TIMEOUT_MS='750';PRICING_QUOTE_TTL_SECONDS='1800';REDIS_URL='redis://127.0.0.1:56321';KAFKA_BROKERS='127.0.0.1:59321';KAFKA_DOMAIN_EVENTS_TOPIC='hotelai.ai-v1-demo.events.v1'}
$node=(Get-Command node).Source
Start-Owned 'backend' $node @('dist/main.js') (Join-Path $root '3_backend_core') $backendEnv
Wait-Http 'http://127.0.0.1:53223/api/v1/core/health/ready'
Start-Owned 'frontend' $node @('node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','53224') (Join-Path $root '4_frontend_nextjs') @{
    HOTELAI_VALIDATION_BUILD='local-ai';NODE_ENV='production';BACKEND_API_URL='http://127.0.0.1:53223/api/v1/core';FRONTEND_ORIGIN='http://127.0.0.1:53224'
}
Wait-Http 'http://127.0.0.1:53224/api/health'
Require-Headroom
Write-Output 'Application stack started; Qwen inference, backup equality and performance gates still require verification.'

$ErrorActionPreference = 'Stop'

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$ConfiguredEnvFile = if ($env:DOCKER_ENV_FILE) { $env:DOCKER_ENV_FILE } elseif ($env:DOCKER_COMPOSE_ENV_FILE) { $env:DOCKER_COMPOSE_ENV_FILE } else { '.env.docker.dev' }
$EnvFile = if ([System.IO.Path]::IsPathRooted($ConfiguredEnvFile)) { $ConfiguredEnvFile } else { Join-Path $RootDir $ConfiguredEnvFile }
$FallbackFile = Join-Path $RootDir '.env.docker.dev.fallback'
$SourceFile = if (Test-Path $EnvFile) { $EnvFile } else { $FallbackFile }
$ComposeArgs = @('-f', (Join-Path $RootDir 'compose.yaml'))

if (Test-Path $EnvFile) {
  $ComposeArgs += @('--env-file', $EnvFile)
}

if (-not (Test-Path $SourceFile)) {
  throw "Missing Docker environment file. Expected $EnvFile or $FallbackFile."
}

$values = @{}
Get-Content $SourceFile | ForEach-Object {
  if ($_ -match '^(?<key>[A-Z0-9_]+)=(?<value>.*)$') {
    $values[$Matches.key] = $Matches.value
  }
}

$webPort = $values['PUBLIC_WEB_PORT']
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webPort/healthz" | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webPort/api/health" | Out-Null
docker compose @ComposeArgs exec -T postgres pg_isready -U $values['POSTGRES_USER'] -d $values['POSTGRES_DB'] | Out-Null

Write-Host 'Gateway, API, and PostgreSQL health checks passed.'
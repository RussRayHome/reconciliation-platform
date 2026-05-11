$ErrorActionPreference = 'Stop'

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$ConfiguredEnvFile = if ($env:DOCKER_ENV_FILE) { $env:DOCKER_ENV_FILE } elseif ($env:DOCKER_COMPOSE_ENV_FILE) { $env:DOCKER_COMPOSE_ENV_FILE } else { '.env.docker.dev' }
$EnvFile = if ([System.IO.Path]::IsPathRooted($ConfiguredEnvFile)) { $ConfiguredEnvFile } else { Join-Path $RootDir $ConfiguredEnvFile }
$FallbackFile = Join-Path $RootDir '.env.docker.dev.example'
$SourceFile = if (Test-Path $EnvFile) { $EnvFile } else { $FallbackFile }

if (-not (Test-Path $SourceFile)) {
  throw "Missing Docker environment file. Expected $EnvFile or $FallbackFile."
}

$values = @{}
Get-Content $SourceFile | ForEach-Object {
  if ($_ -match '^(?<key>[A-Z0-9_]+)=(?<value>.*)$') {
    $values[$Matches.key] = $Matches.value
  }
}

foreach ($name in 'PUBLIC_WEB_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL') {
  if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
    throw "Missing required variable: $name"
  }
}

Write-Host "Using Docker environment values from $SourceFile"
Write-Host "PUBLIC_WEB_PORT=$($values['PUBLIC_WEB_PORT'])"
Write-Host "POSTGRES_DB=$($values['POSTGRES_DB'])"
Write-Host "POSTGRES_USER=$($values['POSTGRES_USER'])"
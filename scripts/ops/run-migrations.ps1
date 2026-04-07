$ErrorActionPreference = 'Stop'

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$ConfiguredEnvFile = if ($env:DOCKER_ENV_FILE) { $env:DOCKER_ENV_FILE } elseif ($env:DOCKER_COMPOSE_ENV_FILE) { $env:DOCKER_COMPOSE_ENV_FILE } else { '.env.docker' }
$EnvFile = if ([System.IO.Path]::IsPathRooted($ConfiguredEnvFile)) { $ConfiguredEnvFile } else { (Join-Path $RootDir $ConfiguredEnvFile) }
$ComposeArgs = @('-f', (Join-Path $RootDir 'compose.yaml'))

if (Test-Path $EnvFile) {
  $ComposeArgs += @('--env-file', $EnvFile)
}

& (Join-Path $PSScriptRoot 'validate-env.ps1')
docker compose @ComposeArgs up --build migrate
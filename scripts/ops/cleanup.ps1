$ErrorActionPreference = 'Stop'

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$ConfiguredEnvFile = if ($env:DOCKER_ENV_FILE) { $env:DOCKER_ENV_FILE } elseif ($env:DOCKER_COMPOSE_ENV_FILE) { $env:DOCKER_COMPOSE_ENV_FILE } else { '.env.docker' }
$EnvFile = if ([System.IO.Path]::IsPathRooted($ConfiguredEnvFile)) { $ConfiguredEnvFile } else { (Join-Path $RootDir $ConfiguredEnvFile) }
$ComposeArgs = @('-f', (Join-Path $RootDir 'compose.yaml'))

if (Test-Path $EnvFile) {
  $ComposeArgs += @('--env-file', $EnvFile)
}

docker compose @ComposeArgs down --remove-orphans

if ($args -contains '--prune-volumes') {
  docker compose @ComposeArgs down --remove-orphans --volumes
}

Write-Host 'Local production-like stack cleaned up.'
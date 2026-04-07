$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'cleanup.ps1')
& (Join-Path $PSScriptRoot 'deploy.ps1')
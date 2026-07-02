<#
  agent-relay autostart — register / unregister a per-user logon task that brings
  the agent-relay server online at login (hidden, via start-relay.vbs next to this
  file). The server lazy-starts the board kernel on first request.

  Thin wrapper over the shared autostart-task.ps1 (repo root); the board has its
  own wrapper at server/board/autostart.ps1 that calls the same shared script.

  Usage:
    powershell -ExecutionPolicy Bypass -File autostart.ps1 install
    powershell -ExecutionPolicy Bypass -File autostart.ps1 uninstall
    powershell -ExecutionPolicy Bypass -File autostart.ps1 status     (default)
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status'
)

& (Join-Path $PSScriptRoot 'autostart-task.ps1') `
  -Action $Action `
  -TaskName 'agent-relay' `
  -Vbs (Join-Path $PSScriptRoot 'start-relay.vbs') `
  -Description 'Bring the agent-relay server online at logon.' `
  -RunningNote 'a server already running stays up until you stop it or reboot'

<#
  switchboard autostart — register / unregister a per-user logon task that brings
  the board online at login (hidden, via start-board.vbs sitting next to this file).

  Thin wrapper over the shared autostart-task.ps1 at the repo root; the agent-relay
  server has its own wrapper (../../autostart.ps1) that calls the same shared script.

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

& (Join-Path $PSScriptRoot '..\..\autostart-task.ps1') `
  -Action $Action `
  -TaskName 'switchboard' `
  -Vbs (Join-Path $PSScriptRoot 'start-board.vbs') `
  -Description 'Bring the switchboard board online at logon.' `
  -RunningNote "a board already running stays up until 'sb down' or reboot"

<#
  agent-relay autostart — register / unregister a per-user logon task that brings
  the agent-relay server online at login (hidden, via start-relay.vbs next to this
  file). The server lazy-starts the board kernel on first request.

  Runs as the current user in the interactive session (LogonType Interactive) so
  the board's shells land in your desktop session, not session 0. No admin needed
  for a self-scoped task; if registration is denied, run from an elevated shell.

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

$ErrorActionPreference = 'Stop'
$TaskName = 'agent-relay'
$vbs = Join-Path $PSScriptRoot 'start-relay.vbs'

function Get-RelayTask { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

switch ($Action) {

  'install' {
    if (-not (Test-Path $vbs)) { throw "launcher not found: $vbs" }
    $action    = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
    $trigger   = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
    try {
      Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
        -Description 'Bring the agent-relay server online at logon.' -Force | Out-Null
    } catch [Microsoft.Management.Infrastructure.CimException] {
      throw "register failed ($($_.Exception.Message)). Try again from an elevated PowerShell."
    }
    Start-ScheduledTask -TaskName $TaskName   # bring it up now, don't wait for next logon
    Write-Host "registered '$TaskName' (runs at logon -> $vbs) and started it"
  }

  'uninstall' {
    if (Get-RelayTask) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Host "unregistered '$TaskName' (a server already running stays up until you stop it or reboot)"
    } else {
      Write-Host "'$TaskName' was not registered"
    }
  }

  'status' {
    $task = Get-RelayTask
    if ($task) { Write-Host "'$TaskName' registered - state: $($task.State)" }
    else       { Write-Host "'$TaskName' not registered" }
  }
}

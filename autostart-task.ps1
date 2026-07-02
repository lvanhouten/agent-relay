<#
  Shared logon-task installer for both the agent-relay server and the switchboard
  board. Not run directly — the two thin wrappers (autostart.ps1 at the repo root
  and server/board/autostart.ps1) call this with their own task name, launcher
  .vbs, and description.

  Registers a per-user task in the interactive session (LogonType Interactive) so
  the board's shells land in your desktop session, not session 0. No admin needed
  for a self-scoped task; if registration is denied, run from an elevated shell.
#>
param(
  [Parameter(Mandatory)][ValidateSet('install', 'uninstall', 'status')][string]$Action,
  [Parameter(Mandatory)][string]$TaskName,
  [Parameter(Mandatory)][string]$Vbs,
  [Parameter(Mandatory)][string]$Description,
  # Extra hint appended to the uninstall message: how a still-running instance is
  # stopped (it keeps running after the task is unregistered).
  [string]$RunningNote = ''
)

$ErrorActionPreference = 'Stop'

function Get-RelayTask { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

switch ($Action) {

  'install' {
    if (-not (Test-Path $Vbs)) { throw "launcher not found: $Vbs" }
    $action    = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Vbs`""
    $trigger   = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
    try {
      Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
        -Description $Description -Force | Out-Null
    } catch [Microsoft.Management.Infrastructure.CimException] {
      throw "register failed ($($_.Exception.Message)). Try again from an elevated PowerShell."
    }
    Start-ScheduledTask -TaskName $TaskName   # bring it up now, don't wait for next logon
    Write-Host "registered '$TaskName' (runs at logon -> $Vbs) and started it"
  }

  'uninstall' {
    if (Get-RelayTask) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      $note = if ($RunningNote) { " ($RunningNote)" } else { '' }
      Write-Host "unregistered '$TaskName'$note"
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

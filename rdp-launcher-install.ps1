<#
  Installer for the RDP client-aware relay launcher (rdp-launcher.ps1). Registers a
  per-user scheduled task that fires on Terminal Services session connect (21) and
  reconnect (25), running in the connecting user's interactive session so the
  launched window lands in the right place.

  Follows the same install/uninstall/status shape and interactive-principal posture
  as autostart-task.ps1, but uses an EVENT trigger (built via MSFT_TaskEventTrigger
  with an XPath subscription) — there is no New-ScheduledTaskTrigger parameter for
  arbitrary event-log events, so the shared -AtLogOn installer can't express it.

  Usage:
    powershell -ExecutionPolicy Bypass -File rdp-launcher-install.ps1 install
    powershell -ExecutionPolicy Bypass -File rdp-launcher-install.ps1 uninstall
    powershell -ExecutionPolicy Bypass -File rdp-launcher-install.ps1 status     (default)

  Extra install args are forwarded to the launcher (e.g. tune the phone rule or
  name a desktop client to ignore):
    ... install -WidthThreshold 800 -DesktopClientNames HOME-DESKTOP,OFFICE-PC
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status',
  # Passed through to rdp-launcher.ps1 at each fire.
  [string]$Url = 'http://localhost:3017',
  [string]$Browser = 'msedge',
  [int]$WidthThreshold = 900,
  [string[]]$DesktopClientNames = @(),
  [string[]]$PhoneClientNames = @(),
  [string]$WindowTitle = 'agent-relay'
)

$ErrorActionPreference = 'Stop'

$TaskName = 'agent-relay-rdp-launcher'
$Launcher = Join-Path $PSScriptRoot 'rdp-launcher.ps1'

function Get-Task { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

switch ($Action) {

  'install' {
    if (-not (Test-Path $Launcher)) { throw "launcher not found: $Launcher" }

    # Forward the tuning params into the launcher's argument string. Name lists
    # travel as ONE quoted comma-joined argument — `-File` does not split "A,B"
    # into array elements (verified), so the launcher splits on commas itself;
    # the quotes keep a name with spaces from splitting at the argv level.
    $launcherArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`"" +
      " -Url `"$Url`" -Browser `"$Browser`" -WidthThreshold $WidthThreshold -WindowTitle `"$WindowTitle`""
    if ($DesktopClientNames.Count -gt 0) {
      $launcherArgs += " -DesktopClientNames `"$($DesktopClientNames -join ',')`""
    }
    if ($PhoneClientNames.Count -gt 0) {
      $launcherArgs += " -PhoneClientNames `"$($PhoneClientNames -join ',')`""
    }
    $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $launcherArgs

    # Event trigger: fire on LocalSessionManager 21 (logon) OR 25 (reconnect). One
    # subscription, two IDs — reconnect from a different device reuses the session
    # with new geometry, so the launcher must re-evaluate per event (it does).
    $evtClass = Get-CimClass -Namespace 'Root/Microsoft/Windows/TaskScheduler' -ClassName 'MSFT_TaskEventTrigger'
    $trigger = New-CimInstance -CimClass $evtClass -ClientOnly
    $trigger.Enabled = $true
    $trigger.Subscription = @'
<QueryList><Query Id="0" Path="Microsoft-Windows-TerminalServices-LocalSessionManager/Operational"><Select Path="Microsoft-Windows-TerminalServices-LocalSessionManager/Operational">*[System[(EventID=21 or EventID=25)]]</Select></Query></QueryList>
'@

    # Interactive principal (same as autostart-task.ps1): runs only when the user is
    # logged on, in their interactive session — a GUI window has nowhere to appear
    # otherwise. Limited run level; no admin needed for a self-scoped task.
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    # IgnoreNew: a burst of connect/reconnect events must not stack launcher runs.
    # The launcher is fast and self-idempotent, but this is the cheap belt.
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

    try {
      Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Principal $principal `
        -Settings $settings -Description 'Open the agent-relay dashboard as an app window when the phone connects via RDP (no-op for desktop/console).' -Force | Out-Null
    } catch [Microsoft.Management.Infrastructure.CimException] {
      throw "register failed ($($_.Exception.Message)). Try again from an elevated PowerShell."
    }
    Write-Host "registered '$TaskName' (fires on RDP connect/reconnect -> $Launcher)"
    Write-Host "  tail the decision log at: $(Join-Path $env:LOCALAPPDATA 'agent-relay\rdp-launcher.log')"
  }

  'uninstall' {
    if (Get-Task) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Host "unregistered '$TaskName' (any open app window stays until you close it)"
    } else {
      Write-Host "'$TaskName' was not registered"
    }
  }

  'status' {
    $task = Get-Task
    if ($task) { Write-Host "'$TaskName' registered - state: $($task.State)" }
    else       { Write-Host "'$TaskName' not registered" }
  }
}

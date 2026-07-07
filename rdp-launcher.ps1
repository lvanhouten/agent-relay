<#
  RDP client-aware relay launcher — fired by an event-triggered scheduled task on
  every Terminal Services session connect/reconnect (see rdp-launcher-install.ps1).
  When the connecting client is the PHONE, it opens the relay dashboard as a
  maximized chromeless browser app window so the dashboard IS the screen the
  moment the phone connects. When the connection is the operator's home desktop
  (or the local console), it never launches — auto-launching a maximized window
  into a full-desktop workflow would be hostile — and it closes any app window
  a previous phone connect left standing, so a phone->desktop reconnect doesn't
  inherit the phone's chromeless window.

  Client discrimination (per _docs/issues/2026-07-06-rdp-client-aware-relay-launcher.md):
    - PRIMARY: session geometry. A phone RDP session is portrait (height > width)
      or narrow (primary width below -WidthThreshold); no desktop client is. This
      is robust to device renames and needs no lookup.
    - SECONDARY: $env:CLIENTNAME. Names in -DesktopClientNames force a no-op
      regardless of geometry (belt-and-suspenders for a known desktop);
      -PhoneClientNames is the symmetric override toward the launch path (for a
      device geometry misreads, e.g. a wide landscape tablet). The observed
      CLIENTNAME is always logged so the real iOS/Android values can be
      recorded — do NOT build the primary rule on them (they are unverified).
    - GATE: a local console logon (SESSIONNAME = 'Console') is never the phone —
      no-op immediately.

  Idempotent on reconnect: if an app-mode window for the same URL already exists,
  it does not open a second one.

  Usage (normally invoked by the scheduled task, but runnable by hand to test the
  decision without waiting for a real connect):
    powershell -ExecutionPolicy Bypass -File rdp-launcher.ps1
    powershell -ExecutionPolicy Bypass -File rdp-launcher.ps1 -WhatIfDecision   # log the decision, never launch
#>
param(
  # The relay dashboard URL. Same-origin model: this is the page you load FROM the
  # relay; localhost is correct on the workstation the relay runs on.
  [string]$Url = 'http://localhost:3017',
  # Browser to open in app mode. Chromium-family (--app / --start-maximized).
  [string]$Browser = 'msedge',
  # Primary-screen width (px) at/below which a landscape session still counts as a
  # phone. Portrait is detected independently of this. 900 clears every desktop
  # resolution while covering a phone held sideways.
  [int]$WidthThreshold = 900,
  # CLIENTNAMEs that force a desktop no-op even if geometry looks phone-like.
  [string[]]$DesktopClientNames = @(),
  # CLIENTNAMEs that force the phone path without consulting geometry — the
  # symmetric override for a device geometry misreads (e.g. a landscape tablet
  # wider than -WidthThreshold). CLIENTNAME values are unverified for iOS/
  # Android; read them from the decision log before relying on this.
  [string[]]$PhoneClientNames = @(),
  # Log only the decision; never launch a window (dry-run for testing the rule).
  [switch]$WhatIfDecision
)

$ErrorActionPreference = 'Stop'

# Normalize the name lists: `powershell -File` binds "A,B" as ONE array element
# (verified — it does NOT split on commas), and the scheduled task the installer
# registers forwards names exactly that way. Splitting here makes both call
# shapes work — a real array from a direct call, or a comma-joined string from
# the task — and keeps names with inner spaces intact.
function Split-Names([string[]]$names) {
  @($names | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
$DesktopClientNames = Split-Names $DesktopClientNames
$PhoneClientNames = Split-Names $PhoneClientNames

# Log next to the board secret (owner-only profile dir) so debugging an
# event-triggered hidden task isn't guesswork — every fire records its inputs and
# the branch it took. This is the only durable window into a task that runs
# invisibly in a remote session.
$logDir = Join-Path $env:LOCALAPPDATA 'agent-relay'
$logPath = Join-Path $logDir 'rdp-launcher.log'
function Write-Log($msg) {
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    # Bounded like the board's tombstone ring: past ~256KB keep the newest 500
    # lines. Truncate-in-place, no rotation siblings to manage.
    if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 262144) {
      Set-Content -Path $logPath -Value (Get-Content $logPath -Tail 500)
    }
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -Path $logPath -Value "[$stamp] $msg"
  } catch { <# logging must never take the launcher down #> }
}

# Primary-screen bounds via WinForms. In an RDP session these reflect the
# connecting client's resolution. The metrics can settle slightly AFTER the logon
# event fires (issue risk), so retry until they read non-zero rather than trust
# the first sample.
function Get-PrimaryBounds {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 12; $i++) {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if ($b.Width -gt 0 -and $b.Height -gt 0) { return $b }
    Start-Sleep -Milliseconds 500
  }
  return [System.Windows.Forms.Screen]::PrimaryScreen.Bounds  # last read, even if 0
}

# The phone path's idempotency check and the desktop path's stale-window
# teardown match the same thing: an app-mode browser process for this exact URL.
$appArg = "--app=$Url"
function Get-AppWindowProcesses {
  @(
    Get-CimInstance Win32_Process -Filter "Name = '$Browser.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -like "*$appArg*" }
  )
}

# A DESKTOP-classified connect closes the maximized app window an earlier PHONE
# connect to this same Windows session may have left standing — a per-event
# no-op decision is right, but the window otherwise outlives the phone session
# across a phone->desktop reconnect and stays imposed on the desktop workflow.
# The UNKNOWN branch deliberately does NOT call this: no evidence, no action.
function Close-StaleAppWindow {
  $existing = Get-AppWindowProcesses
  if ($existing.Count -eq 0) { return }
  if ($WhatIfDecision) {
    Write-Log "stale app window present (pid $($existing[0].ProcessId)) -> would close (WhatIfDecision)"
    return
  }
  foreach ($p in $existing) {
    try {
      Stop-Process -Id $p.ProcessId -ErrorAction Stop
      Write-Log "closed stale app window from an earlier phone connect (pid $($p.ProcessId))"
    } catch {
      Write-Log "close FAILED for stale app window (pid $($p.ProcessId)): $($_.Exception.Message)"
    }
  }
}

$clientName = if ($env:CLIENTNAME) { $env:CLIENTNAME } else { '(none)' }
$sessionName = if ($env:SESSIONNAME) { $env:SESSIONNAME } else { '(none)' }
Write-Log "fired: SESSIONNAME=$sessionName CLIENTNAME=$clientName"

# Gate 1 — a local console logon is never the phone.
if ($sessionName -eq 'Console') {
  Write-Log 'decision: DESKTOP/console (SESSIONNAME=Console) -> no launch'
  Close-StaleAppWindow
  return
}

# Gate 2 — an explicitly-named desktop client forces a no-op.
if ($DesktopClientNames -contains $env:CLIENTNAME) {
  Write-Log "decision: DESKTOP ($clientName in -DesktopClientNames) -> no launch"
  Close-StaleAppWindow
  return
}

# Gate 3 — an explicitly-named phone client forces the launch path without
# consulting geometry (the symmetric override to -DesktopClientNames).
if ($PhoneClientNames -contains $env:CLIENTNAME) {
  Write-Log "decision: PHONE ($clientName in -PhoneClientNames, geometry not consulted)"
} else {
  # Primary rule — geometry. A degenerate read (metrics never settled despite the
  # retry loop) proves nothing about the client — and a zero width would otherwise
  # classify as "narrow", i.e. phone. Unknown must fail toward the no-op: launching
  # a maximized window into a desktop session is the one outcome this script exists
  # to prevent; a phone missing its auto-launch just means tapping the icon by hand.
  $b = Get-PrimaryBounds
  if ($b.Width -le 0 -or $b.Height -le 0) {
    # No teardown here on purpose: unknown is not desktop — closing a window on
    # a failed read could yank it from a live phone session (see Close-StaleAppWindow).
    Write-Log "decision: UNKNOWN (geometry read failed: $($b.Width)x$($b.Height)) -> no-op"
    return
  }
  $portrait = $b.Height -gt $b.Width
  $narrow = $b.Width -lt $WidthThreshold
  $isPhone = $portrait -or $narrow
  Write-Log "geometry: $($b.Width)x$($b.Height) portrait=$portrait narrow(<$WidthThreshold)=$narrow -> phone=$isPhone"

  if (-not $isPhone) {
    Write-Log 'decision: DESKTOP (landscape, wide) -> no launch'
    Close-StaleAppWindow
    return
  }
}

if ($WhatIfDecision) {
  Write-Log 'decision: PHONE -> would launch (WhatIfDecision, no window opened)'
  return
}

# Idempotent: don't stack windows on reconnect. Match an existing app-mode process
# for this exact URL by its command line.
$existing = Get-AppWindowProcesses
if ($existing.Count -gt 0) {
  Write-Log "decision: PHONE, but an app window for $Url already exists (pid $($existing[0].ProcessId)) -> no duplicate"
  return
}

# Launch the chromeless, maximized app window.
try {
  Start-Process $Browser -ArgumentList @($appArg, '--start-maximized') | Out-Null
  Write-Log "decision: PHONE -> launched $Browser $appArg --start-maximized"
} catch {
  Write-Log "launch FAILED for '$Browser': $($_.Exception.Message)"
}

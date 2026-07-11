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
  it does not open a second one — instead it restores (if minimized) and
  foregrounds that window, since a reconnect is exactly when the phone wants
  the dashboard back on top.

  Detection/action both key off the window's TITLE, not its owning process.
  Verified 2026-07-09: a browser that keeps a background "keep running"/
  startup-boost process alive (e.g. Edge's `--no-startup-window
  --win-session-start`) can route a new `--app=` launch into that ALREADY-
  RUNNING process instead of spawning a fresh one — so the process's
  CommandLine never carries `--app=$Url`, and that same process may also own
  the operator's regular browsing windows/tabs. Matching (or worse, closing)
  by owning PID is therefore unreliable and unsafe; every action here targets
  a window HANDLE via Win32 EnumWindows, never a process.

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
  # Exact top-level window title the launched app window carries — matches
  # <title> in client/index.html, which the app never changes at runtime. An
  # app-mode (chromeless) window shows exactly this; a normal tab window
  # always appends "- Profile - Browser", so an exact match is specific to
  # the app-mode window without needing to know its owning process.
  [string]$WindowTitle = 'agent-relay',
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

# Win32 window enumeration — see the file-header note on why this keys off
# the window handle/title rather than the owning process.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

namespace AgentRelay {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  public static class Win32 {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  }
}
'@
$SW_RESTORE = 9
$WM_CLOSE = 0x0010

# All visible top-level windows titled exactly -WindowTitle AND owned by a
# -Browser process (the second check is cheap belt-and-suspenders against some
# unrelated app happening to share the exact title). Returns window handles,
# not processes — see the file-header note on why that distinction matters.
function Get-AppWindowHandles {
  $handles = New-Object System.Collections.Generic.List[IntPtr]
  $callback = {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if ([AgentRelay.Win32]::IsWindowVisible($hWnd)) {
      $len = [AgentRelay.Win32]::GetWindowTextLength($hWnd)
      if ($len -gt 0) {
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [AgentRelay.Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
        if ($sb.ToString() -eq $WindowTitle) {
          [uint32]$procId = 0
          [AgentRelay.Win32]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
          $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
          if ($proc -and $proc.ProcessName -eq $Browser) { $handles.Add($hWnd) }
        }
      }
    }
    return $true
  }
  [AgentRelay.Win32]::EnumWindows([AgentRelay.EnumWindowsProc]$callback, [IntPtr]::Zero) | Out-Null
  @($handles)
}

# A DESKTOP-classified connect closes the maximized app window an earlier PHONE
# connect to this same Windows session may have left standing — a per-event
# no-op decision is right, but the window otherwise outlives the phone session
# across a phone->desktop reconnect and stays imposed on the desktop workflow.
# The UNKNOWN branch deliberately does NOT call this: no evidence, no action.
# Closes the WINDOW (WM_CLOSE), never the owning process — Stop-Process on a
# shared/background browser process would take down every other window that
# process owns, including the operator's regular browsing tabs.
function Close-StaleAppWindow {
  $handles = Get-AppWindowHandles
  if ($handles.Count -eq 0) { return }
  if ($WhatIfDecision) {
    Write-Log "stale app window(s) present ($($handles.Count)) -> would close (WhatIfDecision)"
    return
  }
  foreach ($h in $handles) {
    $ok = [AgentRelay.Win32]::PostMessage($h, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Log "closed stale app window from an earlier phone connect (hwnd=$h): PostMessage returned $ok"
  }
}

# Restore + foreground an existing app window rather than leaving a duplicate-
# launch reconnect as a silent no-op.
function Show-ExistingAppWindow($handles) {
  foreach ($h in $handles) {
    try {
      if ([AgentRelay.Win32]::IsIconic($h)) {
        [AgentRelay.Win32]::ShowWindow($h, $SW_RESTORE) | Out-Null
      }
      $ok = [AgentRelay.Win32]::SetForegroundWindow($h)
      Write-Log "foregrounded existing app window (hwnd=$h): SetForegroundWindow returned $ok"
      return $true
    } catch {
      Write-Log "foreground FAILED for existing app window (hwnd=$h): $($_.Exception.Message)"
    }
  }
  return $false
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

# Idempotent: don't stack windows on reconnect. Match an existing app-mode
# window by its title (see Get-AppWindowHandles).
$existing = Get-AppWindowHandles
if ($existing.Count -gt 0) {
  Write-Log "decision: PHONE, but an app window titled '$WindowTitle' already exists (hwnd=$($existing[0])) -> foregrounding instead of a duplicate launch"
  Show-ExistingAppWindow $existing | Out-Null
  return
}

# Launch the chromeless, maximized app window.
try {
  Start-Process $Browser -ArgumentList @("--app=$Url", '--start-maximized') | Out-Null
  Write-Log "decision: PHONE -> launched $Browser --app=$Url --start-maximized"
} catch {
  Write-Log "launch FAILED for '$Browser': $($_.Exception.Message)"
}

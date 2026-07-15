#!/usr/bin/env pwsh
# Restart the agent-relay dev stack:
#   1. npm run kill   — free :3017 and :5173 (drop orphaned dev processes)
#   2. npm run build  — rebuild the client so the static bundle is fresh
#   3. npm run server — web tier on :3017  (long-running --watch)
#   4. npm run client — Vite dev server on :5173 (long-running)
#
# server and client never exit, so they can't run sequentially in one shell.
# Under Windows Terminal they open as two tabs in the CURRENT window; otherwise
# a window each. Either way each is launched via restart-tab.ps1, which hydrates
# the persisted AR_* config itself (see that script for why). Does NOT touch the
# board daemon (named pipes, not a port); restarting that would end every line.

$root = $PSScriptRoot
# Reuse whichever PowerShell host is running this script (pwsh or Windows
# PowerShell) for the child tabs/windows, rather than guessing.
$psHost = (Get-Process -Id $PID).Path
$tab = Join-Path $root 'restart-tab.ps1'

Write-Host '==> npm run kill' -ForegroundColor Cyan
npm run kill --prefix $root

Write-Host '==> npm run build' -ForegroundColor Cyan
npm run build --prefix $root
if ($LASTEXITCODE -ne 0) {
    Write-Host 'build failed — not launching server/client' -ForegroundColor Red
    exit $LASTEXITCODE
}

# Prefer Windows Terminal: server + client as two tabs in the CURRENT window.
# `-w 0` targets the current window (the one this script is being run from) so
# the tabs land alongside it instead of spawning a separate window. Each tab runs
# restart-tab.ps1, which sets its own working dir and hydrates AR_* itself — so
# it doesn't matter that a tab added to an existing window inherits that window's
# (possibly stale) environment rather than this script's. The `-File` args carry
# no inner `;`, so the lone ';' element below is unambiguously wt's tab delimiter.
# No Windows Terminal -> a window each (same launcher).
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) {
    Write-Host '==> launching server (:3017) + client (:5173) as tabs in the current window' -ForegroundColor Cyan
    Start-Process wt.exe -ArgumentList @(
        '-w', '0',
        'new-tab', '--title', 'ar-server', $psHost, '-NoExit', '-File', $tab, 'server', $root,
        ';',
        'new-tab', '--title', 'ar-client', $psHost, '-NoExit', '-File', $tab, 'client', $root
    )
    Write-Host 'stack restarted — server and client are running as tabs in the current window' -ForegroundColor Green
} else {
    Write-Host '==> launching server (:3017) in a new window' -ForegroundColor Cyan
    Start-Process $psHost -ArgumentList '-NoExit', '-File', $tab, 'server', $root

    Write-Host '==> launching client (:5173) in a new window' -ForegroundColor Cyan
    Start-Process $psHost -ArgumentList '-NoExit', '-File', $tab, 'client', $root

    Write-Host 'stack restarted — server and client are running in their own windows (Windows Terminal not found)' -ForegroundColor Green
}

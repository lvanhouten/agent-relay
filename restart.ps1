#!/usr/bin/env pwsh
# Restart the agent-relay dev stack:
#   1. npm run kill   — free :3017 and :5173 (drop orphaned dev processes)
#   2. npm run build  — rebuild the client so the static bundle is fresh
#   3. npm run server — web tier on :3017  (long-running --watch; own window)
#   4. npm run client — Vite dev server on :5173 (long-running; own window)
#
# server and client never exit, so they can't run sequentially in one shell —
# each is launched in its own window. Does NOT touch the board daemon (named
# pipes, not a port); restarting that would end every live line.

$root = $PSScriptRoot
# Reuse whichever PowerShell host is running this script (pwsh or Windows
# PowerShell) for the child windows, rather than guessing.
$psHost = (Get-Process -Id $PID).Path

Write-Host '==> npm run kill' -ForegroundColor Cyan
npm run kill --prefix $root

Write-Host '==> npm run build' -ForegroundColor Cyan
npm run build --prefix $root
if ($LASTEXITCODE -ne 0) {
    Write-Host 'build failed — not launching server/client' -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host '==> launching server (:3017) in a new window' -ForegroundColor Cyan
Start-Process $psHost -ArgumentList '-NoExit', '-Command', "Set-Location '$root'; npm run server"

Write-Host '==> launching client (:5173) in a new window' -ForegroundColor Cyan
Start-Process $psHost -ArgumentList '-NoExit', '-Command', "Set-Location '$root'; npm run client"

Write-Host 'stack restarted — server and client are running in their own windows' -ForegroundColor Green

#!/usr/bin/env pwsh
# Per-tab launcher for restart.ps1. Runs one long-lived dev process (server or
# client) after hydrating the persisted AR_* config from the User registry.
#
# The hydration lives HERE, in the tab itself, rather than in restart.ps1's
# process, on purpose: restart.ps1 now opens tabs in the CURRENT Windows Terminal
# window, and a tab added to an existing window is spawned by that window's host
# process — so it inherits the HOST's environment, not restart.ps1's. If that
# host started before the AR_* vars were saved it carries a stale (empty) copy,
# and the server prints "push notifications: off" despite the vars being set.
# Reading the registry at tab startup sidesteps the whole inheritance question:
# the tab is correct no matter who spawned it.
param(
    [Parameter(Mandatory)][ValidateSet('server', 'client')][string]$Task,
    [Parameter(Mandatory)][string]$Root
)

$userVars = [Environment]::GetEnvironmentVariables('User')
foreach ($name in $userVars.Keys) {
    if ($name -like 'AR_*') { Set-Item -Path "env:$name" -Value $userVars[$name] }
}

Set-Location $Root
npm run $Task

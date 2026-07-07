# Adversarial Review: client-aware RDP relay launcher (slice 4 of 5 + seams)

**Scope:** `rdp-launcher.ps1` (client discrimination + idempotent app-window launch), `rdp-launcher-install.ps1` (event-triggered scheduled task, LocalSessionManager 21/25) — PowerShell, no server/client code.
**Reviewed:** `44c26d3..2902e0f` (slice of the `3bd5d96..a19a39a` backlog review; working tree clean)
**Verdict:** CONCERNS (2 warnings, one at confidence 80)

Panel: Saboteur / Maintainer / Security Auditor (single isolated pass). Constraints honored: "unverified on a real phone" was not itself flagged (decision-logging is the accepted mitigation); findings below are concrete defects that would bite when it *is* tried, or on the already-live desktop path.

### Warnings

**W1. Geometry-read failure defaults to *phone* — the opposite of fail-safe** — `rdp-launcher.ps1:65-73` (`Get-PrimaryBounds`), `:92-98` (classification) · confidence 80 · Saboteur
`Get-PrimaryBounds` documents that after exhausting retries it returns the last read *"even if 0"*. A zero-width bounds then classifies as phone: `0 -lt $WidthThreshold → $narrow = $true → $isPhone = $true`. So the exact failure the retry loop was built for (display metrics not settled at event time — the intent doc's own named risk) produces a maximized chromeless Edge window on the operator's **home-desktop** session: precisely the "actively hostile" outcome the feature's one hard requirement ("desktop = strict no-op") exists to prevent.
**Fix:** treat degenerate bounds (`$b.Width -le 0 -or $b.Height -le 0`) as an explicit "unknown → no-op" branch with its own log line, distinct from a genuine desktop classification.
**Resolution (fixed):** degenerate bounds now short-circuit to a distinct `decision: UNKNOWN (geometry read failed: WxH) -> no-op` branch before portrait/narrow classification, with a comment pinning the fail-safe rationale (unknown must never launch).

**W2. Desktop reconnect after a phone session leaves the maximized app window standing** — `rdp-launcher.ps1:98-101` (no-op branch; no teardown logic anywhere) · confidence 60 · Saboteur
Phone connects → window opens; the operator later reconnects to the *same* session from the desktop → geometry reads desktop → script correctly launches nothing — but the previously-opened maximized window is still imposed on the now-desktop workflow. Per-event evaluation is satisfied for the event's *action*, but the stated goal isn't met across the transition. The uninstall message ("any open app window stays until you close it") shows windows outliving the task was known; this in-session transition wasn't addressed.
**Fix:** on a desktop-classified event, detect an existing app-mode window matching `$appArg` (the same check the phone path's idempotency already does) and close/minimize it.
**Resolution (fixed):** the `$appArg` process match is now a shared `Get-AppWindowProcesses` (used by both the phone idempotency check and the new `Close-StaleAppWindow`), and every desktop-classified branch (console gate, `-DesktopClientNames` gate, geometry-desktop) closes a standing app window; the UNKNOWN branch deliberately takes no action, and `-WhatIfDecision` logs "would close" without killing. Caveat shared with the pre-existing idempotency check: if Chromium hands the `--app` window off to an existing browser process, the command-line match may miss it — same detection limits as before, now applied symmetrically. Desktop dry-run verified.

### Notes

**N1. Decision log grows unbounded** — `rdp-launcher.ps1:160-168` (`Write-Log`) · confidence 65 · Saboteur
`Add-Content` appends forever; no rotation or cap — unlike the board's own tombstone ring (capped at 20), the in-repo model for exactly this.
**Fix:** keep last N lines or cap file size before appending.

**N2. Install/uninstall/status boilerplate re-implemented instead of shared with `autostart-task.ps1`** — `rdp-launcher-install.ps1:43-102` vs `autostart-task.ps1:23-57` · confidence 55 · Maintainer
The docstring correctly justifies a bespoke *trigger* (no cmdlet support for arbitrary event IDs) — but `Get-Task`, `uninstall`, and `status` are near-identical copies with no such reason. A third autostart-style script makes three drifting copies.
**Fix:** factor the get/uninstall/status shape into a shared helper parameterized by task name; keep only trigger construction bespoke.

**N3. No symmetric override to force a device *toward* phone** — `rdp-launcher.ps1:39-40,85-89` · confidence 55 · Maintainer
`-DesktopClientNames` can only force *away* from phone. The intent doc names a tablet (landscape, ≥900px) as the next stress case, and the only lever today is lowering `-WidthThreshold` globally.
**Fix:** add `-PhoneClientNames`, or state in the header that it's deferred until CLIENTNAME values are verified.

**N4. `--app=<url> --start-maximized` is a known-flaky Chromium combination on first launch** — `rdp-launcher.ps1:122` · confidence 40 · Saboteur
Chromium restores per-profile window bounds for `--app=` URLs; with no prior placement state, `--start-maximized` is commonly ignored. This is the concrete candidate for what fails when the unverified phone-positive path is first exercised (desktop testing never launches a window at all).
**Fix:** if the first phone test lands unmaximized, drive `--window-position/--window-size` from the read geometry instead.

**N5. `-DesktopClientNames` forwarding breaks on a name containing a space** — `rdp-launcher-install.ps1:54-56` · confidence 40 · Maintainer
The unquoted comma-join splits at a space in the registered task's argument string — and only surfaces when the task *fires*, not at install time.
**Fix:** quote each name, or document the constraint next to the usage example.

**N6. RDP-client-supplied `CLIENTNAME` is interpolated unsanitized into the decision log** — `rdp-launcher.ps1:75-77,87` · confidence 35 · Security
Within the single-operator threat model this isn't a boundary crossing (reaching the code path requires valid RDP credentials) — but the log is the feature's *sole* forensic surface, and a spoofed value can inject misleading lines into it. No action needed unless the log is ever machine-consumed.

### Summary

The discrimination architecture matches the intent doc (geometry primary, CLIENTNAME secondary, per-event evaluation) — but W1 inverts the feature's single hard requirement on its most anticipated failure path: the script's own retry loop exists because geometry can fail, and the failure value classifies as phone. Fix W1 before the next home-desktop RDP session, and W2 alongside it; N4 is worth pre-empting before the first real phone test.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 80 | Zero-geometry read fail-opens to phone (hostile desktop launch) | fixed |
| W2 | WARNING | 60 | Stale app window persists across phone→desktop reconnect | fixed |
| N1 | NOTE | 65 | Decision log unbounded | (open) |
| N2 | NOTE | 55 | Installer boilerplate duplicated from autostart-task.ps1 | (open) |
| N3 | NOTE | 55 | No `-PhoneClientNames` symmetric override | (open) |
| N4 | NOTE | 40 | `--app` + `--start-maximized` flaky on first launch | (open) |
| N5 | NOTE | 40 | Space-in-name breaks argument forwarding at fire time | (open) |
| N6 | NOTE | 35 | CLIENTNAME log injection (threat-model-bounded) | (open) |

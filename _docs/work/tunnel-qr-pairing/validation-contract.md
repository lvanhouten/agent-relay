# Validation Contract — tunnel-qr-pairing

Behavioral assertions defining feature-level done, authored implementation-blind from the PRD's user stories before any code exists. `prd-to-briefs` maps each brief to the `VC-n` ids it covers and fails slicing if any assertion is uncovered; `adversarial-review` sweeps promised-vs-delivered against these where present; a future conducted verify stage will record per-assertion status.

## Assertions

**VC-1.** With the tunnel environment variable set and tailscale available, starting the relay makes it reachable at the machine's stable tailnet URL with no other operator action.
**VC-2.** Startup with an active tunnel prints the tunnel URL and a scannable QR code in the server console.
**VC-3.** Opening the QR's URL on a fresh device lands on the sessions screen with no token typed and no additional tap.
**VC-4.** Immediately after a QR pairing, the browser's address bar and history contain no token.
**VC-5.** Opening a pairing QR minted before a token rotation shows the manual login form with a clear error — not a blank or frozen page.
**VC-6.** A device paired before a server restart still reaches its sessions screen after the restart with no re-login.
**VC-7.** A logged-in browser reloaded (or evicted and reopened) reaches the sessions screen with no re-login.
**VC-8.** From a paired phone via the tunnel, the operator can list sessions, spawn one, attach to its terminal, type into it, and kill it.
**VC-9.** A logged-in browser can open a "pair a device" view showing a scannable pairing QR, without access to the server console.
**VC-10.** The pair-a-device view shows whether the tunnel is up; when it is down, it says why.
**VC-11.** When a tunnel precondition fails (tailscale missing or logged out, no client build), the relay still starts and serves localhost, and the console states what failed and how to fix it.
**VC-12.** With auth disabled, no tunnel ever comes up regardless of the tunnel environment variable, and the console states why and how to fix it.
**VC-13.** If the tunnel process dies while the relay runs, it comes back without operator action, at the same URL, and already-paired devices reconnect without re-pairing.
**VC-14.** A request bearing the access token as a bearer credential succeeds against the API exactly as before the feature.
**VC-15.** Manual token login from a page loaded over cleartext http on a non-localhost host still requires the explicit second-click acknowledgement before the token is sent.
**VC-16.** The login page loads through the tunnel without any credential.
**VC-17.** Deleting the persisted credentials invalidates every previously paired device at once (each lands back on the login form).
**VC-18.** An unpinned token generated on one run is the same token on the next run.

## Drift discipline

When a brief legitimately deviates during build, the assertion it invalidates must be updated or consciously superseded — never silently dropped. Replace the assertion line in place with a struck line carrying the literal keyword `SUPERSEDED`, the deviating brief id, and the one-line why.

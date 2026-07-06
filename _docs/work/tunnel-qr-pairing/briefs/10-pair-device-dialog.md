## Agent Brief

**Category:** enhancement
**Summary:** "Pair a device" affordance on the sessions screen: fetches the pairing endpoint, renders the pairing URL as a QR client-side, shows tunnel status

**Current behavior:**
The sessions screen offers session cards, a filter, the recently-exited section, and the new-session dialog. There is no way to see the pairing QR from the UI — pairing information exists only in the server console, which the primary (autostart, headless) deployment never shows.

**Desired behavior:**
A small affordance on the sessions screen (placement consistent with the existing header/actions styling, design-system components via the `@ds` alias) opening a dialog that:

- Calls the pairing endpoint (cookie-authed like every other call) on open — not on page load.
- **Tunnel up**: renders the pairing URL as a QR code client-side (`qrcode` package, new client dependency — canvas or SVG output; must work in the dialog on both themes) with the URL text beneath it for manual entry.
- **Tunnel down**: no QR; shows the state and the reason string from the endpoint (which names the failed precondition and fix) — a degraded tunnel is diagnosable from the UI, not just the console.
- **Tunnel disabled** (`AR_TUNNEL` unset): explains that tunneling is off and names the env var to enable it.
- Endpoint errors (503 board-unreachable doesn't apply here, but network failure/401 do) surface as an inline error in the dialog, not an unhandled rejection — same discipline as the new-session dialog's failure handling.
- The dialog holds a credential-bearing URL: render it only while open; no caching of the pairing URL in app state after close.

**Key interfaces:**

- Consumes the pairing endpoint contract: `{ tunnel: { state: 'up'|'down'|'disabled', reason: string|null }, pairingUrl: string|null }` via a new client-core fetch wrapper (`getPairing()`), typed in the core's contracts.
- `qrcode` (client workspace dependency) — used only by this dialog.
- Sessions-screen JSX stays thin; any non-trivial logic (status→display mapping) belongs in the core where it's testable.

**Acceptance criteria:**

- [ ] Affordance visible on the sessions screen; opening it fetches pairing info and renders a scannable QR when the tunnel is up (manual verification: scan it).
- [ ] The URL text shown matches the QR content exactly.
- [ ] Down and disabled states render their reasons/instructions; no QR element present.
- [ ] A fetch failure shows an inline dialog error; the dialog stays open.
- [ ] Closing the dialog leaves no pairing URL in component/app state.
- [ ] Typecheck green; any added core logic (status mapping, wrapper) has core-style tests.

**Out of scope:**

- Displaying paired/connected devices (parked — separate backlog issue).
- Startup/terminal QR (server-wiring brief).
- Any auth or endpoint changes.

**Depends on:** 05-pairing-endpoints (endpoint contract)

**Covers:** VC-9, VC-10

**Runtime:** parallel-safe

## Agent Brief

**Category:** enhancement
**Summary:** Origin policy accepts a runtime-added tunnel origin, with a pin test that tunneled requests pass the gate regardless of Host-header rewriting

**Current behavior:**
The origin policy allows: no-Origin (non-browser), loopback origins, same-origin (Origin host equals the request's Host header), and a static allowlist parsed once from `AR_CORS_ORIGIN`. A tunneled page's requests pass only if the tailscale proxy happens to preserve the Host header so the same-origin comparison matches — unverified proxy behavior the feature must not bet on.

**Desired behavior:**
The policy gains a runtime-addable origin set: at startup, when the tunnel supervisor discovers the tailnet URL, the wiring layer registers that origin, and `originAllowed` treats registered origins exactly like allowlisted ones. The function's pure/injectable character is preserved (the existing signature keeps its injectable allowlist parameter; the runtime set is equally injectable or passed alongside). Idempotent registration; origins compared as full origins (scheme + host + port semantics identical to the existing allowlist comparison).

The **pin test** the original issue demanded: a request whose Origin is the tailnet origin (e.g. `https://machine.tailnet.ts.net`) passes the gate even when the request's Host header is something else entirely (e.g. `127.0.0.1:3017`) — proving the gate holds without assuming proxy Host passthrough.

**Key interfaces:**

- The origin module's `originAllowed(origin, host, allowlist?)` — unchanged for existing callers (REST CORS config and WS upgrade both consume it; neither call site should need to change beyond, at most, how the shared set is plumbed).
- A new registration function (e.g. `allowRuntimeOrigin(origin)`) the wiring layer calls once per discovered tunnel URL.

**Acceptance criteria:**

- [ ] A registered tunnel origin passes `originAllowed` with a mismatched Host header (the pin test above).
- [ ] Unregistered non-loopback, non-same-origin, non-allowlisted origins still fail.
- [ ] Registration is idempotent and additive to (not a replacement for) the `AR_CORS_ORIGIN` allowlist.
- [ ] All existing origin tests pass unmodified.
- [ ] New cases extend the existing origin test suite's style (pure function, table-ish cases).

**Out of scope:**

- Calling the registration at startup (server-wiring brief).
- Tunnel URL discovery (tunnel-supervisor brief).
- Any change to loopback/same-origin/no-Origin semantics.

**Depends on:** none

**Covers:** VC-16

**Runtime:** parallel-safe

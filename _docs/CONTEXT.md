# Domain Context

Glossary of canonical terms for agent-relay. Terms here are settled — use them
exactly; don't introduce synonyms.

## Glossary

### Session
A PTY session — a live shell owned by the board (a "line"), listed on the
sessions screen and attachable from a terminal view. **Never** refers to
browser authentication state; the auth-side artifact is the *auth cookie*.

### Access token
The relay's root credential: the bearer secret that gates the REST API and, for
non-browser clients, the WS attach. Printed at startup when generated. Proving
possession of it is how a device pairs.

### Auth cookie
The browser-side credential issued after a successful token login: an HttpOnly,
HMAC-signed cookie verified statelessly by the server. Deliberately not called
a "session cookie" — *session* is taken (see Session). Revoked wholesale by
rotating the access token / signing secret.

### Pairing
The flow that takes a device from unauthenticated to holding an auth cookie:
scan the pairing QR (or type the token), pass the login probe, receive the
cookie. A *paired* device stays authenticated across server restarts and page
reloads.

### Pairing QR
A QR code encoding the relay's public URL with the access token in the URL
fragment — a one-time bootstrap: the client reads the fragment, exchanges it
for an auth cookie, and strips it from the URL. Fragments are used because they
never reach server logs or Referer headers.

### Tunnel
The reverse-proxy path that makes the relay reachable from another device —
v1: `tailscale serve`, exposing the relay at the machine's stable tailnet URL.
Reachability is tailnet-scoped; the tunnel is not the auth boundary (the token
and origin gates still apply).

### Same-origin model
The client's reachability rule: you reach a relay by loading the page *from*
it (directly or through a tunnel) — page, API, and WS stream all target the
page's own origin. There is no typed "relay host".

### Raw output
The unmodified PTY byte stream a line produces: text interleaved with ANSI
escapes, cursor moves, and repaint frames. What `read_output` / the data pipe
have always returned. For a plain shell it *is* the meaningful artifact; for an
alt-screen TUI it is churn. The stable default — rendered mode never replaces
it.

### Rendered screen
The current terminal grid of a line — rows × cols of plain characters as a
human would see them on `sb join`, with no escapes and no duplicate frames —
produced by feeding the raw output through a headless VT emulator. Bounded in
size regardless of how much churn the stream carried. The artifact an agent
consumer actually wants when reading TUI state (which dialog option is
highlighted, waiting vs. executing). Complements the session transcript, never
replaces it (transcript = history + verbatim command text; screen = current UI
state).

### Reconstructed replay
The line history a newly-attached client receives on join, rebuilt through a
throwaway VT emulator instead of dumping the raw byte-log verbatim. The raw log's
cursor-**relative** redraws (a shell prompt or a normal-buffer TUI moving up N
lines to repaint) are only coherent at the width they were emitted at; replayed
into a joiner of a different width they land on the wrong rows and leave stale
characters — the garble that a manual resize used to be needed to clear.
Reconstructing at the capture width and serializing flat logical lines (with
colors) lets the joiner re-wrap them clean at its own width. Distinct from the
*rendered screen*: that is the current grid only (bounded, no history); this
keeps scrollback so join still shows what ran before you attached. The emulator
is transient (per attach, disposed after) — it does **not** touch the lazy
per-line screen emulator of ADR 0002.

### Beacon
A hook-driven POST to `/api/beacon` in which a Claude Code session reports a
lifecycle transition — `SessionStart`, `Stop`, or `SessionEnd` — for the line it
runs in. Every beacon carries the full binding (`sessionId` = the board line,
plus `claudeSessionId`, `transcriptPath`, `cwd`). The *binding* is self-healing
and order-independent: any single beacon re-establishes the identity the relay
may have lost to a restart, regardless of which beacon arrives. *State
transitions* are not commutative — they follow event semantics (a `Stop` marks
turn-done, a later `SessionStart`/`SessionEnd` moves past it), so "order-
independent" describes the binding, not the state machine. Distinct from a
*notification* (`/api/notify`), which buzzes a phone and may flag needs-input; a
beacon reports state and never pushes.

### Claude line
A Session (board line) whose Claude Code hooks have beaconed it — the relay has
seen a `SessionStart` (or, self-healing, any `Stop`) for it, so it knows the line
is running an agent and derives that line's attention state from honest hook
signals rather than the idleMs heuristic. A `SessionEnd` beacon removes the
marker: the agent exited and the line (now a plain shell) reverts to the
heuristic. A line with no beacons (a plain shell, or a repo whose hooks aren't
configured) is not a Claude line and keeps the heuristic untouched. The
distinction is web-tier only and dies with the relay process; a re-fired beacon
re-establishes it.

### Turn done
The attention state of a Claude line whose agent has ended its turn (a `Stop`
beacon) and is now waiting on the user. The process and its Session (PTY) stay
alive — deliberately *not* "done" or "exited": a *turn* is one agent
request/response cycle, not the session. Cleared the moment the operator answers
(WS input) or the agent produces new output. Reads differently from an *exited*
tombstone, which is a dead process.

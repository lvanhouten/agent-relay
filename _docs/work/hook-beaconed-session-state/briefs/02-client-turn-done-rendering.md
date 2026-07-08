## Agent Brief

**Category:** enhancement
**Summary:** Render the `turn-done` session status on the sessions screen — a distinct-color status dot, a "turn done" label, and a two-level attention sort that lifts needs-input and turn-done cards to the top.

**Current behavior:**
The client decodes a session DTO's `status` string into a card presentation through a single lookup table in the client core (the one place the status vocabulary is decoded — it maps each status to a status-dot variant, a card label, and whether the dot pulses). Today it knows `running` (online dot, "running"), `idle` (idle dot, "quiet"), and `needs-input` (attention dot, "needs input", pulsing); an unknown status falls back loudly (error dot, pulsing, raw status as label). The sessions screen filters out exited lines into a collapsed "recently exited" section and sorts the live grid with a single-key lift that raises only `needs-input` cards to the top. The status-dot component supports variants `online` / `idle` / `attention` / `error`, each backed by a design-system color token, and honors an explicit `pulse` override.

The server will begin emitting a new `status` value, `turn-done`, for a Claude line whose agent has ended its turn (see brief `01-server-beacon-plumbing`). Nothing on the client renders it yet — it currently hits the loud unknown-status fallback.

**Desired behavior:**
Teach the client to render `turn-done` as a first-class, visually distinct attention state.

- The status-decode table gains a `turn-done` entry: a **distinct-color** dot (its own status-dot variant, e.g. `done`, backed by a **new design-system color token**), the label **"turn done"**, and **no pulse**. The distinctness must be carried by **color, not motion** — the pulse animation is disabled under `prefers-reduced-motion` and absent in a static screenshot, and the state must stay distinguishable from the pulsing `needs-input` dot (which shares neither the color nor the steadiness) in all of those conditions. The label ("turn done" vs "needs input") is the secondary distinguisher.
- A pure sort-rank helper, co-located with the decode table, maps a status to an ordering rank encoding the precedence **needs-input > turn-done > everything else** (all remaining live statuses equal). The sessions screen replaces its single-key needs-input lift with a sort by this rank, so needs-input cards sit above turn-done cards, which sit above the rest of the live grid.
- A `turn-done` card is a **live** card — it renders in the main grid, never routed to the "recently exited" tombstone section (which stays reserved for `exited`).
- The client's session-DTO `status` documentation is updated to mention `turn-done` (turn ended, process still alive, distinct from `exited`). The DTO type stays a plain string for cross-version tolerance — no enum.

**Key interfaces:**

- The status-decode table (the client-core module that maps `status` → `{ dot, label, pulse }`) — gains a `turn-done` entry `{ dot: <new distinct variant>, label: "turn done", pulse: false }`.
- The status-dot component + design tokens — a new dot variant and a new `--status-*` color token for it.
- A new pure `attentionRank(status): number` helper beside the decode table — total order with needs-input highest, turn-done next, the rest equal.
- The sessions screen's live-grid sort — consumes `attentionRank` instead of the inline needs-input-only comparison.
- The session DTO `status` doc comment — mentions `turn-done`.

**Acceptance criteria:**

- [ ] A session whose `status` is `turn-done` renders in the live grid with a "turn done" label and a dot whose **color** differs from the needs-input dot — verifiable in the running app and in a static screenshot (no reliance on animation).
- [ ] The turn-done dot does not pulse; the needs-input dot still does.
- [ ] Under `prefers-reduced-motion`, turn-done and needs-input cards remain visually distinguishable (by dot color and label).
- [ ] In the live grid, needs-input cards sort above turn-done cards, which sort above all other live cards — observable by driving the app with a mix of statuses.
- [ ] A `turn-done` card never appears in the "recently exited" section.
- [ ] `attentionFor('turn-done')` returns the distinct-color, non-pulsing "turn done" view; `attentionRank` orders needs-input > turn-done > running = idle. Both covered by unit tests mirroring the existing decode-table tests.
- [ ] An unknown/unrecognized status still hits the existing loud fallback (unchanged).

**Out of scope:**

- Any server-side production of the `turn-done` status, the `/api/beacon` endpoint, and beacon state — brief `01-server-beacon-plumbing`.
- Terminal-screen chrome; the tombstone/exited rendering; the needs-input behavior itself (only its sort rank relative to turn-done changes).

**Depends on:** none

**Covers:** VC-2, VC-3, VC-4

**Runtime:** parallel-safe

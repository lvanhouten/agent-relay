# Execution notes — tunnel-qr-pairing

Operational decisions from the planning session (2026-07-06), for whichever
session runs the build:

- **Run `execute-briefs` inline from a normal session — not `conduct-feature`.**
  Decided with the operator: 7 of 10 briefs touch the server web tier, and a
  conducted run's stage sessions live on the switchboard board — a stray
  board-affecting action from an AFK executor would saw off the branch the
  conductor sits on. Inline execution keeps brief-executors as plain subagent
  worktrees with no switchboard lines in the loop.
- **Board-safety watchpoints for executors and integration gates:**
  - No brief touches `server/board/` — treat any executor diff there as a
    deviation to reject.
  - No test may RPC the board without `AGENT_RELAY_PIPE` namespacing (a bare
    RPC hits the production board; `shutdown` would end every live line).
    The new server modules are all injectable-seam tested and shouldn't need
    the board at all.
  - Brief 07 boots the relay to verify: use a non-default `PORT`, never
    `npm run kill`, while the operator's real relay may be running on :3017.
- Brief numbering note: tunnel-supervisor is 04 and pairing-endpoints is 05
  (swapped from an earlier draft so NN follows the dependency order).

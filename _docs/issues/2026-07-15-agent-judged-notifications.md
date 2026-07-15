# Let Claude decide whether a turn is worth notifying

**Source:** User ask, 2026-07-15 — while wiring the Pushover `Stop` hook (fires a "turn done" push on *every* turn-end), the question surfaced: instead of an unconditional ping, is there a way Claude could "think" about whether a notification is actually warranted?
**Status:** 💡 Proposed — 2026-07-15. Design fork to settle before code.
**Kind:** Enhancement (notification quality) — mostly hook/agent config, not relay code.
**Modules:** none in the relay for the recommended path (reuses `POST /api/notify`); a hook script (`~/.claude/agent-relay-notify.ps1`), `~/.claude/settings.json`, and a `CLAUDE.md` rule. Option B / the MCP variant would touch `server/board/mcp-server.js`.
**Severity:** Low effort / high daily-quality — kills notification noise, which is the difference between a channel you watch and one you mute.

## Motivation

The relay's push path (`POST /api/notify`, Pushover sink) is driven by Claude Code hooks. Today two fire:

- **`Notification` hook** — Claude is *blocked* asking for input/permission. This is a genuine "needs you now" signal.
- **`Stop` hook** — fires on **every** turn-end. A quick one-line answer buzzes your phone exactly as loudly as a 40-minute refactor finishing. That's noise, and a notification channel that cries wolf gets muted — at which point the *real* alerts (the `Notification` one) are lost too.

The ask is to replace the unconditional `Stop` ping with a **judged** one: only notify when the turn-end actually merits it.

### The core constraint: hooks can't think

A Claude Code hook is a deterministic shell command bound to an event. It runs regardless of what Claude concluded — it has no access to Claude's judgment, only to the event and (for `Stop`) the transcript path. So "should I notify?" judgment has to live in one of exactly two places:

1. **In the agent** — Claude, mid-turn with full live context, decides to fire a notification itself.
2. **In a separate judge** — the hook invokes a *second* model call to rate the finished turn.

Everything below is a consequence of that fork.

## Proposal outline

### Option A — Claude self-notifies, by judgment (recommended)

Drop the `Stop` hook. Give Claude a low-friction `notify-me` command and a rule for when to use it; Claude decides *during its turn* whether the situation warrants a push and, if so, sends one with a **meaningful** message.

- **Keep the `Notification` hook as-is.** When Claude is blocked on a permission prompt it is *not* in an active turn and *cannot* run a tool — so it cannot self-notify. That case must stay a deterministic hook. Option A only replaces the `Stop` (turn-done) ping.
- **Generalize the notify script.** `agent-relay-notify.ps1` currently sends a canned title/body. Add `-Title`/`-Body` params so Claude passes a real message ("refactor done — 12 tests green", "blocked: the migration needs a prod DB URL I don't have"). Same token-off-argv discipline (curl `-K -` via stdin). Everything it needs is already in the line's env: `AGENT_RELAY_SESSION` (lights the exact card) and the pinned `AR_TOKEN`.
- **Add a "when to notify" rule** to `~/.claude/CLAUDE.md` (user-scope, matching where the hooks live). Draft heuristic:
  - **Notify** when: you finish a task that took real wall-clock time or many steps; you hit an error you can't resolve and are stopping; you're ending the turn on a decision only the user can make; a long-running background job you were watching finished.
  - **Don't notify** for: quick answers, routine intermediate turns, anything the user is plainly sitting there watching.
  - **Payload discipline** (inherited from the notifier design): `title`/`body` transit Pushover's servers — keep them to a one-line status, *never* session output, code, paths, or anything secret/PHI.
- **Pros:** the richest possible judgment — Claude has the actual context (what was asked, how long it took, whether it's stuck) that no after-the-fact judge can reconstruct; **zero** extra cost/latency; notifications become rare and meaningful by construction.
- **Cons:** relies on Claude following the rule; it will sometimes forget. But that failure is **quiet** (a missed ping), which is the safe direction — the opposite of today's failure mode (over-notifying until you mute).

### Option B — an LLM judge inside the `Stop` hook

Keep a `Stop` hook, but instead of always pushing, have it pipe the last exchange (the hook receives `transcript_path` on stdin) to a cheap headless call — `claude -p "Should this turn notify the user? Answer yes/no + a one-line reason and suggested message."` — and push only on "yes."

- **Pros:** deterministic — can't be forgotten; applies one consistent rule across every session regardless of which agent/model ran the turn.
- **Cons:** spawns a model call on **every** turn-end (token cost + a second or two of latency on each stop, including the quick turns you'd never want to notify on); the judge sees only the transcript, not Claude's live reasoning; adds a moving part (the judge prompt) to tune.

### Variant — expose notify as an MCP tool instead of a shell script

Orthogonal to A vs B: rather than Claude shelling out to a script, add a `notify_user` tool to the existing MCP server (`server/board/mcp-server.js`, alongside the `switchboard_*` tools). Makes self-notify a first-class, discoverable action with a typed schema rather than a memorized command line. More work (server change, re-register the MCP server) and not required — Claude can already POST to `/api/notify` via Bash today — but the cleaner long-term shape if Option A proves its worth.

## Risks / open questions

- **Reliability of the rule (Option A).** Claude will occasionally under- or over-notify. Under-notify is benign; over-notify is the thing we're fixing, so the rule should bias conservative ("when in doubt, don't"). Worth a few real sessions to calibrate the wording.
- **The blocked-on-permission case is not self-notifiable.** Re-stating because it's the easy mistake: don't let Option A tempt you into dropping the `Notification` hook too. A blocked agent can't run a tool.
- **Which shell runs Claude's notify command.** Same Windows gotcha the hooks hit: no `bash` on PATH, and the recipe is PowerShell. The `notify-me` affordance must be invokable from whatever shell Claude's `Bash` tool uses on this machine (Git Bash) *and* portable — a `.ps1` invoked via `powershell -File` works from either. Verify before trusting it.
- **Payload discipline is now Claude's responsibility.** With a canned body, leakage was impossible. Letting Claude write the body means the CLAUDE.md rule must explicitly forbid putting output/secrets in `title`/`body` — those transit a third-party push service. The server caps length (`NOTIFY_MAX` in `api.js`) but cannot police content.
- **Cost/latency (Option B only).** A `claude -p` per turn-end is real spend and a perceptible pause on *every* stop, most of which are turns you'd never notify on — i.e. you pay the judge most often precisely when the answer is "no." This is the main reason A is preferred.
- **Consistency vs. context trade-off is the actual decision.** B buys determinism at the cost of context and money; A buys context and thrift at the cost of determinism. Pick based on whether "Claude sometimes forgets to ping me" is more annoying than "every quick turn costs a judge call."
- **Priority interaction with `needs-input`.** A self-sent "turn done, but I need a decision" notification and the `needs-input` card flag can describe the same moment. Make sure a self-notify that sets `needsInput:true` composes with the existing attention overlay (needs-input > turn-done > running) rather than fighting it — see `BoardSessions._attention` / the beacon compose order.

## Trigger signals to prioritize

- The `Stop`-ping noise becoming annoying enough to mute the channel — the direct driver; if you've already reached for "turn off notifications," do this instead.
- Wanting notifications to carry a *useful* message ("what finished / what's blocked") rather than a generic "a session ended its turn."
- Enough real sessions under the current always-on `Stop` hook to know which turns you actually wanted a ping for — that lived experience is what calibrates the CLAUDE.md rule (or the judge prompt).

## Relationship to other issues

- **`2026-07-02-hook-driven-push-notifications.md`** — this builds directly on the landed Pushover + `needs-input` plumbing (`server/src/notifiers.js`, `POST /api/notify`). No relay change needed for Option A; it's a smarter *caller* of the same endpoint.
- **`2026-07-02-notification-action-buttons.md`** — a judged "needs a decision" notification is the natural place approve/deny buttons would attach, once Web Push delivery exists to host them. Sibling, downstream.
- **`2026-07-02-claude-native-lines.md` / beacon state** — the beacon compose order (`needs-input > turn-done > running`) is the precedent for how a self-sent attention signal should layer; reuse it, don't reinvent.

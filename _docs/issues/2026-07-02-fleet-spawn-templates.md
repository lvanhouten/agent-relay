# Spawning a real session from the phone means re-typing shell, cwd, and command every time

**Source:** Feature-gap brainstorm, 2026-07-02 — the create form is fine on a desktop and miserable on a phone; the sessions people actually spawn are the same handful of shapes every time.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** client/SessionsScreen (phase 1), server/api (phase 2)
**Severity:** Low–Medium — small effort, turns the phone into a launcher instead of only a monitor.

## Motivation

`POST /sessions` already accepts everything needed (`name`, `shell`, `cwd`, `command` — mapped to the board's `run` by `BoardSessions.spawn`). What's missing is memory: "Claude in ContractDomain", "Claude in agent-relay", "plain pwsh in ~" get re-typed each time, with a full Windows path on a soft keyboard. Saved templates make spawn a one-tap action, which matters most exactly where typing is worst.

## Proposal outline

- Phase 1, client-only: a `templates` store in `localStorage` (`[{ label, name, shell, cwd, command }]`); the create form gains a preset picker plus "save as template" on any successful spawn. (small)
- Phase 2, server-side store (a JSON file next to the push-subscription store) behind `/api/templates`, so templates follow the operator across devices — the phone is precisely the device where you *don't* want to author them. (medium)
- A template can prefill-and-edit rather than fire blindly — one tap to load, second tap to spawn, so a stale cwd doesn't silently spawn a shell in the wrong repo.

## Risks / open questions

- A template's `command` is an arbitrary shell command executed on tap; server-side storage makes `/api/templates` a persistence spot for command injection *by whoever holds the token* — which is already game-over via `POST /sessions`, so no new trust boundary, but worth stating in the endpoint's doc comment.
- Don't log template commands: the board already deliberately logs only the run-command length (`board.js` — credentials can ride argv); the template store should follow the same rule in any server logs.
- Multi-session templates ("audit pipeline: 3 blind sessions") are tempting but drag in orchestration semantics (ordering, shared naming) — out of scope until `2026-07-02-claude-native-lines.md`-style fleet awareness exists; a template stays 1 template = 1 line for now.

## Trigger signals to prioritize

- Repeatedly spawning the same session shape from the phone.
- Push notifications + attention states landing — once monitoring is effortless, spawning becomes the remaining friction.

# Working directory in the new-session dialog is a bare text field — no way to browse

**Source:** Came up alongside the terminal-header title-overflow fix (2026-07-09) while looking at the create-session dialog. `2026-07-02-fleet-spawn-templates.md` already named this exact pain ("a full Windows path on a soft keyboard") and solved it by letting a *saved* cwd be replayed with one tap; this doc covers the case templates don't: a directory you haven't spawned in before.
**Status:** ✅ Landed — 2026-07-14. Shipped as designed, plus a client-side folder filter over the loaded entries. Endpoint `GET /api/fs/browse` in `server/src/fsBrowse.js` (dirs-only, cap 500 + `truncated`, typed `not-found`/`not-a-directory`/`denied`, lexical `parent` null at a filesystem root); `resolveCwd` extracted to `server/src/paths.js` and shared with spawn. Client: touch-first `chrome/DirectoryPicker.jsx` that swaps the dialog body (no stacked modal), present in both shells; `core/pickerPath.ts` for the child-path join. Directory browsing intentionally has **no path sandbox** — a read-only listing sits under ADR-0001's accepted trust ceiling (a token holder can already spawn a shell in any cwd). Deferred: symlinked/junction directories are not surfaced (would need a per-entry stat); the filter operates only over the first-500 loaded entries; scoped-tokens will need an explicit call on whether a read scope includes fs browsing.
**Kind:** Enhancement
**Modules:** client (`chrome/NewSessionDialog.jsx` + `chrome/DirectoryPicker.jsx`), server (`src/api.js`, `src/fsBrowse.js`, `src/paths.js`)
**Severity:** Low–Medium — pure convenience; the text field always keeps working as a fallback.

## Motivation

`Working directory` (`SessionsScreen.jsx:334-340`) is a plain mono `Input` — the operator types (or pastes) an absolute path or `~/...`, which `BoardSessions.spawn` → `resolveCwd` (`server/src/sessions.js`) expands server-side before handing it to `pty.spawn`. That's fine at a desk with a real keyboard and a repo you spawn into daily. It's the friction point on a phone (RDP or tunnel path) or for a repo/worktree you haven't already got memorized or templated — hand-typing `C:\Users\Lukas5856\worktrees\agent-relay\desktop-shell-v1\.worktrees\05` on a soft keyboard, correct casing and all, is exactly the kind of typing spawn-templates already exists to avoid, just for the *first* spawn into a place rather than the tenth.

Critically, this has to be a **server-side** feature, not a browser file picker: the operator's browser may be on a phone, miles from the machine that's actually running the board and spawning shells. The relevant filesystem is the server's, not the client device's — so the only place a "browse" UI can source its listing from is a new read-only endpoint that walks the same filesystem `resolveCwd`/`pty.spawn` already touch.

## Proposal outline

- **New endpoint `GET /api/fs/browse?path=<value>`** (server) — resolves `path` the same way `resolveCwd` does (leading `~` expansion; reuse/export that helper from `sessions.js` rather than re-implement it), then `fs.readdir(resolved, { withFileTypes: true })` and returns `{ path, parent, entries: [{ name, isDir }] }`. Directories only need surfacing as *navigable*; files can be omitted entirely or shown de-emphasized for context — the field only ever wants a directory.
    - Cap the entries returned (e.g. 500) with a `truncated: true` flag — `C:\Windows` or a `node_modules` dropped one level too high must not turn into a multi-MB response or a frozen list UI.
    - A permission-denied (`EACCES`) or non-existent path returns a typed error in the body (e.g. `{ error: 'not-a-directory' }` / `{ error: 'denied' }`), never a 500 — browsing into a locked-down system folder is an expected, non-exceptional click.
    - Same auth gate as every other `/api` route (the global `authMiddleware`) — no new trust boundary. Whoever holds the token can already spawn a shell and run arbitrary commands in any cwd via `POST /sessions` (the accepted ADR-0001 ceiling, already invoked to reason about spawn-templates' command-injection surface) — a *read-only directory listing* grants strictly less than that. Still worth a one-line note in the endpoint's doc comment for the next reader, same as `/beacon`'s `transcriptPath`.
- **Client: a "Browse…" affordance on the Working Directory field** (`SessionsScreen.jsx`) — opens a small breadcrumb-style picker: current path, a scrollable list of subdirectories (tap to descend), `..` to go up, "Use this folder" to accept and populate the field. Keep the text field itself untouched and always editable — the browser is an assist, not a replacement; a path you already know is still fastest to just type or paste.
- **Seed the picker's starting path** from the field's current value (so re-opening it from a prefilled template continues where that left off) or the user's home directory if the field is still the `~/` default.

## Risks / open questions

- **Response size / pathological directories** — must be capped and truncated defensively (see above); untested against something like a mapped network drive or a directory with tens of thousands of entries.
- **Windows-specific edges** — drive roots (`C:\`) have no meaningful ".." target; UNC paths (`\\host\share`) and drive enumeration (`A:`–`Z:`) are a reasonable stretch goal but out of scope for a first cut, which can start rooted at the home directory and typed-path navigation only.
- **Symlinks / junctions** can loop on themselves when computing a `parent` breadcrumb — resolve defensively, don't `realpath`-follow indefinitely.
- **Future scoped tokens** (`2026-07-02-scoped-tokens.md`) will need an explicit call on whether a read-only token scope should include filesystem browsing — today there's one trust tier, so this is free; that stops being true once scopes narrower than "can spawn anything" exist.
- **Doesn't yet compose with spawn templates** — a natural follow-up, not required for v1, is letting "Save as template" pull its label from the browsed folder name.

## Trigger signals to prioritize

- Spawning into a repo/worktree that has no saved template yet — the exact gap templates don't cover.
- Continued phone-based session spawning (RDP path, tunnel path) where the friction is worst.
- A user report of a mistyped/miscased path silently failing `pty.spawn` (currently a manual retype-and-guess loop).

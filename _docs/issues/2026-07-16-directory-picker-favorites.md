# Favorite folders in the new-session browse dialog

**Source:** User ask, 2026-07-16. The directory browser (`2026-07-09-session-dialog-directory-browser.md`, landed 2026-07-14) removed the hand-type-a-Windows-path pain for a *first* spawn into a place, but every re-open of the picker still starts from the seeded path and re-descends the tree by tap. A handful of folders (the repos/worktree roots you spawn into constantly) deserve a one-tap jump instead of the same three-tap descent every time.
**Status:** ✅ Landed — 2026-07-16. Shipped as designed (phase 1, client-only). Store `core/favorites.ts` (pure ops + `localStorage` wrappers, mirrors `core/templates.ts`): dedupe by canonical path (trailing-separator-insensitive), cap at 20 dropping the oldest, guarded parse that can't throw on a corrupt/foreign value; 14 unit tests. `chrome/DirectoryPicker.jsx` grew a star pin toggle in the path bar (fills when the current folder is pinned) and a favorites chip strip (star + folder leaf name) that jumps via the existing `navigate()` stale-listing guard, each chip's × unpinning. No server change. Deferred: phase 2 (server-side store so favorites roam across devices — pairs with spawn-templates phase 2); stale-favorite pruning stays lazy (a dead path fails on tap into the picker's existing `not-found` error rather than a background stat sweep).
**Kind:** Enhancement (convenience)
**Modules:** client only for phase 1 — `chrome/DirectoryPicker.jsx` + a new pure `core/favorites.ts` (mirrors `core/templates.ts`). No server change. Phase 2 (roaming) would touch `src/api.js`, same as spawn-templates phase 2.
**Severity:** Low — pure convenience; the picker's tree navigation and the text field both keep working untouched.

## Motivation

`DirectoryPicker` (`chrome/DirectoryPicker.jsx`) seeds from the field's current value and lists that folder's subdirectories; you descend by tapping rows and accept with "Use this folder". That's the right model for reaching a folder you haven't spawned in before, but it makes the *common* case - jumping to one of the same few roots you always spawn into - a repeated tap-tap-tap descent (or, on the phone paths where this feature earns its keep, several taps down a deep worktree tree each time).

Spawn templates (`core/templates.ts`) already solve the "replay a whole spawn" case - a saved `{name, cwd, command}` fills the entire create form on tap. But a favorite is a **lighter, different-granularity** thing: not a whole spawn shape, just a folder shortcut *inside the browser*. You want to jump the picker to `C:\Users\Lukas5856\dev` and then browse from there into whichever child repo you're after today - a starting point, not a committed cwd. Templates can't express "start browsing here"; that's the gap.

## Proposal outline

- **A client-only favorites store, `core/favorites.ts`** - modeled directly on `core/templates.ts`: pure array ops (`addFavorite`/`removeFavorite`, dedupe by path), a guarded `parse` that drops anything that isn't a clean string list (a hand-edited/truncated `localStorage` value must never throw inside the picker's mount, same discipline as `parseTemplates`/`parseFrame`), and thin `load`/`save` wrappers where `save` returns whether the write persisted. A favorite is just the absolute folder path string - no name, no command. Key `ar-fav-folders`.
    - Dedupe by the path itself (normalized trailing-separator, matching how `fallbackLabel` strips them); adding an already-favorited path is a no-op, not a duplicate.
    - Cap the list (e.g. 20) so the favorites strip can't grow unbounded and crowd out the folder list.
- **A pin toggle in the picker's path bar** (`DirectoryPicker.jsx`) - a star/pin `IconButton` next to the current `result.path`, filled when the current folder is already a favorite, outline when not; tapping toggles it. The current folder *is* the selection in this picker (that's the existing model - see the component's header comment), so "favorite the folder I'm looking at" reads naturally there.
- **A favorites strip at the top of the picker** - a chip row (above the filter `Input`, or above the `..` row) of one-tap jumps: tap a favorite → `navigate(path)`. Reuse the existing `navigate()` request-id guard so a fast favorite-tap-through can't land a stale listing (the `reqRef` monotonic-seq logic already there). A tiny × on each chip removes it, mirroring the template-chip delete affordance in `NewSessionDialog`.
    - A favorite whose path no longer exists shouldn't be silently dropped on sight, but tapping it lands on the existing `not-found` error the picker already renders (`ERROR_TEXT['not-found']`) - offer removal from there rather than a background stat-and-prune (no extra round-trips, consistent with the "no per-entry stat" call the browser doc already made for symlinks).
- **Seeding unchanged.** Favorites are an *assist over* the existing seed-from-field behavior, not a replacement - the picker still opens on the field's current path; the strip just offers shortcuts once it's open.

## Risks / open questions

- **Favorites vs. templates overlap.** Both are "saved places." Keep them distinct in the UI so it's obvious a template fills the *whole form* (name + cwd + command) while a favorite only jumps the *browser*. If that distinction proves confusing in use, the alternative is to fold "favorite" into templates as a cwd-only template - but that muddies the template shape (blank name/command) and loses the "start browsing here vs. commit this cwd" difference, so start them separate.
- **Path normalization on Windows.** Dedupe/`isFavorite` comparison must agree on casing and separators or the same folder favorites twice or the pin shows hollow on a folder that's actually saved. Decide the canonical form once (the server returns `result.path` from `fsBrowse`; favorite exactly that string, and compare against exactly that) rather than normalizing in two places.
- **Stale favorites** (a deleted/renamed repo, a worktree that's been torn down). Lazy handling (fail on tap, offer remove) is the low-cost call; a periodic validation sweep is over-engineering for a ~20-entry list.
- **Phase 2 roaming.** Like spawn-templates phase 2, favorites live only in one browser's `localStorage` until a server-side `/api/favorites` store exists - so they don't follow the operator from desktop to phone, which is exactly the device split where the picker matters most. Worth pairing with templates phase 2 (`2026-07-02-fleet-spawn-templates.md`) if/when that server store lands, sharing the same persistence seam.
- **Scoped tokens.** Same footnote as the browser doc: once a read-only token scope exists (`2026-07-02-scoped-tokens.md`), whether it includes fs browsing is already the open call - favorites ride entirely on that same `GET /api/fs/browse`, so they add no new trust surface.

## Trigger signals to prioritize

- Spawning repeatedly into the same 2-3 roots and feeling the re-descent each time - the direct driver.
- Continued phone-based spawning (RDP/tunnel), where every avoided tap on a soft keyboard/small screen counts most.
- Spawn-templates phase 2 getting picked up - do favorites' persistence in the same pass so both roam together rather than building the server store twice.

## Relationship to other issues

- **`2026-07-09-session-dialog-directory-browser.md`** (landed) - this extends that picker; favorites reuse its `GET /api/fs/browse` endpoint and `navigate()` guard verbatim, no server change.
- **`2026-07-02-fleet-spawn-templates.md`** - the sibling "saved places" feature at a coarser granularity (whole spawn shape). Phase 2's server store is the natural shared home for roaming favorites too.

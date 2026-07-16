# Desktop shell has no "home page" — the detail pane is always a terminal or a bare empty state

**Source:** Noticed 2026-07-15 while using the desktop shell. There's nowhere to *land* that isn't a specific session's terminal.
**Status:** ✅ Landed 2026-07-15 — the "start small" version below (a deselectable fleet-overview pane). A deliberate `home` state in `DesktopWorkspace` suppresses auto-select so `selectedId === null` is reachable; the sidebar brand is the deselect affordance (marked active while home); `desktop/HomePane.jsx` renders the overview (fleet summary chips + needs-attention quick-jumps + the zero-session onboarding sub-case), fed by the pure `core/fleetSummary.ts` (unit-tested). Client-only, no server change. Verified E2E. The maximal dashboard (fleet-wide widgets, live-preview tails) stays open as desktop shell v3 territory.
**Kind:** Enhancement
**Modules:** client (`desktop/DesktopWorkspace.jsx`, `desktop/DetailPane.jsx`)
**Severity:** Low — cosmetic/UX; the workspace is fully functional without it.

## Motivation

The desktop master–detail workspace (`DesktopWorkspace.jsx`) has exactly two detail-pane states:

1. **A session is selected** → `DetailPane` renders that line's `TerminalView`.
2. **Nothing is selected** → `DetailPane`'s `!session` branch shows a minimal empty state ("No active sessions. Start one to get going." + a New session button).

And state 2 is nearly unreachable in practice: the auto-select effect (`DesktopWorkspace.jsx:63-67`) picks the most-recently-active live session whenever `selectedId` is null, so on any load with ≥1 live session you land **straight into a terminal**. There is no neutral landing view — no fleet overview, no welcome/onboarding surface, no "deselect to get back to a dashboard." Once you're in the workspace you're always looking at one specific shell.

This is the gap: a desktop app usually has a home. Here the sidebar is the only fleet-level surface, and it's a narrow list, not a landing page. There's no place that answers "what's the state of everything?" at a glance, and no obvious way to step *back out* of a terminal to a neutral view without killing or dismissing sessions.

## Proposal outline

Give the desktop shell a real home/overview state for the detail pane, shown when the operator explicitly deselects (and optionally as the default landing before a session is chosen).

- **A deliberate "no selection" state** — make `selectedId === null` reachable and meaningful instead of a transient the auto-select effect immediately overwrites. Options: a Home item in the sidebar, a logo/title click, or an `Esc`-to-deselect from the terminal.
    - The auto-select-on-null effect would need to distinguish *initial* null (pick a session) from *deliberate* null (show home). A separate `home` flag, or "only auto-select once on mount," keeps the existing no-flash behavior for fresh creates and dismissed tombstones.
- **A home/overview pane** replacing (or extending) `DetailPane`'s current bare empty state:
    - Fleet summary — live count, idle/needs-attention counts, recently exited — reusing the same DTO attention fields the sidebar and cards already read.
    - Quick actions — New session (already there), maybe recent cwds / spawn-templates as one-tap launches.
    - A genuine empty/onboarding state for the zero-sessions case (what it does today, kept as the sub-case when there's nothing to summarize).
- Keep it **client-only** — this is pure view state over `useSessions`, no server change, same as desktop shell v1.

## Risks / open questions

- **Interaction with auto-select** (`DesktopWorkspace.jsx:63-67`) is the whole subtlety — a deliberate home state must not get clobbered by auto-select, while fresh-create/dismiss selection must keep working. Worth a small tested predicate in `core/` rather than ad-hoc effect guards.
- **Is a home page actually wanted, or just an escape hatch?** The minimal version is "let me deselect and see a summary"; the maximal version is a real dashboard. Start small — a deselectable overview pane — and grow only if it earns it.
- **Overlaps with desktop shell v3 (fleet extras)** (`2026-07-07-desktop-fleet-extras.md`) and the live-preview card work — a home overview is a natural host for fleet-wide widgets. Decide whether this is its own slice or folds into v3.

## Trigger signals to prioritize

- Wanting to step out of a terminal to a neutral view without killing/dismissing anything.
- A fleet large enough that the sidebar list isn't a satisfying "state of everything" answer.
- Picking up desktop shell v3 — build the home pane as the frame those extras hang on.

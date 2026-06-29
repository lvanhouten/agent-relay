# agent-relay · Product UI kit

Interactive, high-fidelity recreation of the agent-relay web client. Three surfaces wired into one click-through flow.

## Flow
`index.html` orchestrates routing + theme:
1. **Login** (`LoginScreen.jsx`) — enter relay host + token, click **Connect**. (Any token ≥ 4 chars connects; shorter shows the rejected-token error.)
2. **Sessions** (`SessionsScreen.jsx`) — filter the live session list, **New session** (dialog), or click a card to attach. Trash icon terminates.
3. **Terminal** (`TerminalScreen.jsx`) — attached session shown as an **agent transcript**: tool-call lines (with tree-style results), agent prose, an inline diff with red/green highlighting, and a working indicator. A **fixed input bar** sits at the bottom — type a request, press Enter, and the session appends your message plus a canned reply. `clear` empties the transcript. Back arrow returns to Sessions.

Theme toggle (sun/moon) is in every screen's chrome and flips `data-theme` on `<body>`.

## Files
- `index.html` — app shell, routing, mock session state, theme.
- `icons.jsx` — Lucide-style inline stroke icons (→ `window.*Icon`).
- `Chrome.jsx` — `BrandLogo`, `TopBar` (→ `window`).
- `LoginScreen.jsx` · `SessionsScreen.jsx` · `TerminalScreen.jsx` (→ `window`).

## Composition
Screens compose the design-system primitives from `window.AgentRelayDesignSystem_9f29b7` — `Button`, `Input`, `Card`, `Badge`, `StatusDot`, `IconButton`, `Switch`, `Kbd` — and reference tokens directly via CSS custom properties. They are cosmetic recreations: the "pty" is mocked, no real socket.

> Mock-only: there is no real relay connection; output is canned. The intent is visual + interaction fidelity, not a working client.

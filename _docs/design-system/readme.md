# agent-relay · Design System

A lightweight web interface for connecting to terminal sessions (`node-pty`) running on a user's **main** machine. Create a new session or reattach to an existing one, all from the browser. This design system defines the brand, visual foundations, and reusable UI for the product's three core surfaces: **Login**, **Sessions**, and **Terminal**.

> **Sources.** No external codebase or Figma file was provided — this system was designed from the product brief. If a real codebase/Figma exists, attach it via the Import menu and this system can be reconciled against it.

---

## Product context

agent-relay is a developer utility. The mental model is a **relay**: a long-lived daemon on your main machine holds your `node-pty` sessions; the web app is a thin, fast client that connects to them. The defining idea is *continuity* — sessions stay alive, scrollback and working directory persist, and you can pick any one back up from anywhere.

Three surfaces:
1. **Login** — authenticate to your relay host (host address + access token).
2. **Sessions** — list of live/idle sessions with status, shell, working dir, last-active; plus "New session".
3. **Terminal** — full-screen interactive terminal attached to one session, with a session header and controls.

---

## Brand at a glance

- **Personality:** technical, precise, quiet-confident. A tool for people who live in a terminal. Never cute, never corporate.
- **Signature element:** the **signal** — a pulsing green dot that means "connected / online". It recurs in the logo (two relay arcs around a node), in `StatusDot`, and in status rows.
- **Aesthetic:** terminal-inspired but refined. Monospace for anything technical, a clean geometric grotesque for UI. Sharp small radii, restrained shadows, dark-mode-native (but fully light-capable).

---

## CONTENT FUNDAMENTALS

How agent-relay writes.

- **Voice:** direct, lowercase-friendly, technical. Talks to developers as peers. No marketing fluff, no exclamation points.
- **Person:** addresses the user as **you** ("Connect to any session", "pick up where you left off"). Refers to the user's machine as **main** or **your machine**.
- **Casing:** Sentence case for buttons and headings ("New session", "Connect to relay"). **UPPERCASE mono** for eyebrow labels and metadata keys ("RELAY HOST", "WORKING DIR", "SHELL"). Product name is always lowercase: **agent-relay**.
- **Tone examples:**
  - Empty state: "No sessions yet. Start one to get going."
  - Error: "Token rejected. Check it and try again." (state the problem + the fix, no blame)
  - Connecting: "Attaching to session…" (present continuous for in-progress)
  - Confirm destructive: "Terminate session? Running processes will be killed."
- **Numbers & metadata:** terse and mono — `pid 48213`, `2 panes`, `last active 4m ago`, `~/projects/api`.
- **Emoji:** none. The brand uses the pulsing dot, `▸` carets, and mono glyphs instead of emoji or decorative unicode.
- **Punctuation:** ellipsis for in-progress; em-dash sparingly; avoid trailing periods on short button labels.

---

## VISUAL FOUNDATIONS

- **Color.** Cool-slate neutral ramp (`--gray-0…950`) carries almost everything. A single **signal-green accent** (`--relay-500`, brighter `--relay-400` in dark) is the only chromatic color used for interaction and "connected" status. Semantic hues (amber idle, red error, blue info) appear only in status/feedback. Dark mode is the native habitat; light mode is a faithful inverse. The **terminal canvas is always near-black** (`--terminal-bg`) regardless of theme — code lives in the dark.
- **Type.** Display/UI = **Space Grotesk** (geometric grotesque, tight tracking on headings). Technical text = **JetBrains Mono** (terminal, labels, metadata, badges, kbd). Eyebrow labels are uppercase mono with `0.12em` tracking. UI body is 15px.
- **Spacing.** Strict 4px grid (`--space-*`). Dense but breathable — sessions list and toolbars are compact; marketing/login screens get more air.
- **Backgrounds.** Mostly flat surfaces — no photographic imagery, no mesh gradients. Depth comes from a 3-step surface stack (app → card → sunken/raised) and hairline borders. The only "atmosphere" is an optional faint dotted/grid texture on dark hero areas and the accent **glow** around live elements.
- **Borders & lines.** Hairline 1px borders (`--border-subtle/default/strong`) do most of the structural work, especially in dark mode where shadows recede. Borders, not shadows, separate regions.
- **Shadows.** Restrained. Light mode uses soft low-opacity elevation (`--shadow-sm/md/lg`); dark mode nearly drops them and uses borders + the accent glow instead. `--glow-accent` (ring + soft green bloom) marks selected/live elements.
- **Radii.** Small and technical: 4–8px on controls and cards, 12px on larger panels, full only on dots/pills. Nothing is pill-soft except status capsules.
- **Corners / cards.** Cards = surface-card background, 1px subtle border, 8px radius, `shadow-sm`. Interactive cards lift 2px and gain an accent border on hover; selected cards get the accent glow. No colored-left-border cards, no gradient cards.
- **Motion.** Quick and functional. `--dur-fast 120ms` for hovers, `--dur-base 180ms` for toggles/cards, `--ease-out` for most, `--ease-snap` for the switch thumb. The one ambient animation is the **signal pulse** (1.8s radar ring on online dots) — everything else is a fade/translate on interaction. Respects `prefers-reduced-motion`.
- **Hover states.** Buttons darken (`--accent-hover`) / shift surface; ghost buttons gain a sunken background; cards lift + accent border; icon buttons gain a sunken background and strengthen text color.
- **Press states.** 1px downward translate on buttons/icon-buttons; accent goes one step darker (`--accent-active`).
- **Focus.** 3px `--accent-ring` outline (box-shadow), never a removed outline.
- **Transparency / blur.** Used sparingly: modal overlays (`--surface-overlay`), soft accent tints (`--accent-soft`) for selected/active backgrounds, and `--*-soft` semantic tints for badges. No heavy glassmorphism.
- **Imagery vibe.** Cool, dark, monochrome-leaning. If product screenshots are shown they sit inside dark terminal chrome. Decorative imagery is avoided in favor of real terminal output.
- **Layout rules.** App shell = fixed top bar + optional left rail (`--sidebar-w 272px`). Content max-widths: `--container-w 1120px`, `--content-w 720px`. Login is centered single-column. Terminal is full-bleed with a fixed header.

---

## ICONOGRAPHY

- **System:** [Lucide](https://lucide.dev) — clean 24×24, 2px stroke, rounded caps/joins. It matches the grotesque + mono pairing and the technical-but-friendly tone. **SUBSTITUTION NOTE:** no icon set shipped with the brief, so Lucide is the chosen default; swap if the product later standardizes on another set.
- **Usage:** stroke icons at 16px (sm controls / inline) and 18–20px (md). Icons inherit `currentColor` so they pick up text color and theme automatically. Use the same stroke weight everywhere; don't mix filled and stroked.
- **Loading:** in HTML, load from CDN — `<script src="https://unpkg.com/lucide@latest"></script>` then `lucide.createIcons()`, or inline the SVG paths (as the component cards do). In React/JSX, inline small stroke SVGs or use `lucide-react`.
- **Emoji / unicode:** no emoji. The brand does use a few mono glyphs as functional marks: `▸` (relay prompt caret), `▍` (cursor block), `+` (new), `×` (close). The pulsing dot replaces any "live"/"online" emoji.
- **Logo assets:** `assets/logo-mark.svg` (rounded-square app mark) and `assets/logo-wordmark.svg` (mark + `agent-relay` mono wordmark; the text uses `currentColor` — inline it or set `color` to recolor per theme).

---

## INDEX — what's in this folder

**Foundations**
- `styles.css` — global entry point (consumers link this one file). `@import`s only.
- `tokens/colors.css` · `typography.css` · `spacing.css` · `effects.css` · `fonts.css` · `base.css`
- `guidelines/*.card.html` — foundation specimen cards (Colors, Type, Spacing, Brand)

**Components** (`components/core/`) — `window.AgentRelayDesignSystem_9f29b7.*`
- `Button`, `IconButton`, `Input`, `Badge`, `StatusDot`, `Card`, `Switch`, `Kbd`
- Each has `.jsx` + `.d.ts` + `.prompt.md`; `core.card.html` is the directory specimen.

**UI kit** (`ui_kits/agent-relay/`)
- `index.html` — interactive click-through: Login → Sessions → Terminal
- Screen components: `LoginScreen.jsx`, `SessionsScreen.jsx`, `TerminalScreen.jsx`, plus shared chrome.

**Assets** (`assets/`) — `logo-mark.svg`, `logo-wordmark.svg`

**Meta**
- `SKILL.md` — Agent-Skills-compatible entry for downloading/reuse.
- `readme.md` — this file.

> The compiler generates `_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json` — never edit those by hand.

### Webfont substitution

Fonts are loaded from **Google Fonts CDN** (Space Grotesk + JetBrains Mono) because no binary font files were provided. To self-host, drop `.woff2` files in `assets/fonts/` and replace the `@import` in `tokens/fonts.css` with `@font-face` rules.

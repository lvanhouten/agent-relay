---
name: agent-relay-design
description: Use this skill to generate well-branded interfaces and assets for agent-relay, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick map
- `readme.md` — full design guide: product context, content fundamentals, visual foundations, iconography, index.
- `styles.css` — global entry point; link this one file to inherit all tokens + fonts.
- `tokens/` — color (light/dark), typography, spacing, effects, fonts.
- `components/core/` — React primitives: Button, IconButton, Input, Badge, StatusDot, Card, Switch, Kbd. Each has a `.prompt.md` with usage.
- `ui_kits/agent-relay/` — interactive Login → Sessions → Terminal recreation.
- `guidelines/*.card.html` — visual specimen cards.
- `assets/` — logo mark + wordmark.

## House rules (the short version)
- **Theme:** dark-native, light-capable. Flip `data-theme="dark"` on a root element. The terminal canvas stays near-black in both themes.
- **Accent:** one signal green (`--relay-500` / `--relay-400` in dark) for interaction + "connected". The pulsing dot is the brand's signature.
- **Type:** Space Grotesk (UI/display), JetBrains Mono (terminal, labels, metadata, badges). Eyebrow labels are UPPERCASE mono, tracked.
- **Voice:** direct, lowercase product name (`agent-relay`), address the user as "you", no emoji, terse mono metadata.
- **Surfaces:** flat; depth from the surface stack + hairline borders. Small radii (4–8px). Restrained shadows; dark mode leans on borders + accent glow.
- **Icons:** Lucide (2px stroke). No emoji.

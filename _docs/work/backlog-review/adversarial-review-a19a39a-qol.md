# Adversarial Review: mobile answer mode + terminal QoL + spawn templates (slice 5 of 5 + seams)

**Scope:** `client/src/core/TerminalView.tsx` (search/serialize/send/pill), `client/src/screens/TerminalScreen.jsx` (composer, chips, find bar, transcript), new pure modules `keyChips.ts` / `scrollPill.ts` / `transcript.ts` / `templates.ts` + tests, `SessionsScreen.jsx` preset picker, `types.ts`, xterm addon deps.
**Reviewed:** `2902e0f..a19a39a` (commits b55e776 + a19a39a; slice of the `3bd5d96..a19a39a` backlog review; working tree clean)
**Verdict:** CONCERNS (4 warnings, three at confidence ≥ 55)

Panel: Saboteur / Maintainer / Security Auditor (single isolated pass). The e2e browser verification documented in the issue docs was honored — findings focus on what manual testing wouldn't catch (disconnection races, IME, quota failures, state staleness).

### Warnings

**W1. Composer Send clears the input even when the message was silently dropped** — `client/src/screens/TerminalScreen.jsx:80-84` (`submitComposer`), `client/src/core/useSessionWS.ts:104-107` (`send`) · confidence 70 · Saboteur
`useSessionWS.send` is a no-op unless the socket is OPEN — no queue, no error. `submitComposer` calls `send(...)` and unconditionally `setComposerText('')`. Scenario: connection is `reconnecting` (a mobile network blip — the exact condition this feature targets), the operator types an answer to a blocking Claude prompt and taps Send: the composer clears as if delivered, but the bytes never left the client, and nothing says so. Chips share the silent drop but don't destroy typed text.
**Fix:** gate/disable Send off `connStatus` (already tracked in the screen), or make `send()` return success so the caller restores the text and surfaces the drop.
**Resolution (fixed):** both halves taken — `useSessionWS.send` (and `TerminalViewHandle.send`) now return a boolean (`true` only when handed to an OPEN socket); `submitComposer` clears the input only on success; Send + chips are disabled (with dimmed/not-allowed styling) whenever `connStatus !== 'online'`. The boolean covers the status-vs-socket race the disable alone would miss. Typecheck + 86 client tests green (no component harness — guarded path is named in-code per repo convention).

**W2. `justSaved` template indicator goes stale after editing the form** — `client/src/screens/SessionsScreen.jsx:222,228,327,335,381` · confidence 70 · Maintainer
`justSaved` is set on save and reset only in `applyTemplate`; none of the three field `onChange` handlers clear it. Save → edit the command → the button still shows the accent "Saved" state, implying the *edited* form is stored when the stored template is pre-edit. Nothing in the file hints at the invariant, so a future fix wired only into `applyTemplate` misses this path.
**Fix:** reset on any field change, or derive the indicator from whether the current form matches a stored template.
**Resolution (fixed):** every form-edit path (three Input onChanges, the quick-command pick, both FlagChipRows) now routes through `editName`/`editCwd`/`editCommand` wrappers that reset `justSaved`, with a comment stating the invariant at the wrappers so a future field can't miss it. `applyTemplate` keeps its explicit reset.

**W3. Reconnect resets the buffer but leaves the find bar's match state stale** — `client/src/core/TerminalView.tsx:109-116` (`onReady`), `client/src/screens/TerminalScreen.jsx:33` · confidence 55 · Saboteur
The reconnect branch calls `term.reset()` and resets the scroll pill, but never clears `searchRef` decorations or notifies `onSearchResultsRef`. With the find bar open across a WS drop, the readout can show "3/5" against a freshly-replayed buffer with zero highlighted matches until the next keystroke.
**Fix:** in the reconnect branch, `clearDecorations()` + emit a reset `SearchResults` (or re-run the current query).
**Resolution (fixed):** the reconnect branch now clears decorations (+ active decoration) and emits `{ resultIndex: -1, resultCount: -1 }` through `onSearchResultsRef`, blanking the readout deterministically; the next keystroke re-runs the query against the replayed buffer. (No component harness — guarded path named in-code per repo convention; typecheck + suite green.)

**W4. Blank-name template saves collide on the literal label `'template'` and silently overwrite** — `client/src/screens/SessionsScreen.jsx:234` · confidence 50 · Saboteur
`const label = name.trim() || 'template'` — two different blank-name saves both upsert the same label; the second silently replaces the first with no confirmation. The upsert-by-label design is sanctioned; the unhandled *fallback* path is not part of that decision.
**Fix:** unique fallback (command/cwd/timestamp), or block when the label would overwrite an entry the user didn't pick.

### Notes

**N1. Transcript `.txt` embeds raw ANSI/SGR escapes** — `client/src/screens/TerminalScreen.jsx:66-77` · confidence 45 · Saboteur
`SerializeAddon.serialize()` reproduces terminal state *including* color/attribute escapes; the `text/plain` `.txt` opens in Notepad full of `\x1b[...m`. Either strip SGR before the Blob or document that the export is an ANSI transcript.

**N2. Transcript is now a durable named artifact** — `client/src/screens/TerminalScreen.jsx:66-77` · confidence 55 · Security (acceptance note — the secrets-in-downloads caveat is stated and accepted; the increment is durability: Downloads-folder cloud sync, browser history, outliving the session)
Optional: a tooltip on the Download button noting the file may contain anything echoed to the terminal.

**N3. Find-bar match readout is untested pure logic left inline in the screen** — `client/src/screens/TerminalScreen.jsx:86-88` (`matchReadout`) · confidence 50 · Maintainer
A real derivation (the `-1` "not computed" sentinel vs a genuine `0` no-match) inline in JSX with no coverage, while every sibling module in this same slice (`keyChips`, `scrollPill`, `transcript`) followed the extract-to-core convention. Same pattern as the attention slice's ATTENTION-table finding — see the seam doc.
**Fix:** extract `searchReadout(term, results)` to `core/` with tests pinning `-1` vs `0`.

**N4. Composer/find-bar Enter handling ignores IME composition — on a mobile-keyboard feature** — `client/src/screens/TerminalScreen.jsx:151-154, 219` · confidence 35 · Saboteur
No `e.nativeEvent.isComposing` guard: a CJK/predictive-text candidate confirmation can prematurely submit partial text to a live agent. Pre-existing repo-wide pattern (LoginScreen has it too) so not a regression — but newly load-bearing here.
**Fix:** `if (e.nativeEvent.isComposing) return;` in both handlers.

**N5. Failed localStorage write still flips the UI to "Saved"** — `client/src/core/templates.ts:75-77`, `client/src/screens/SessionsScreen.jsx:238-240` · confidence 35 · Saboteur
`saveTemplates` swallows quota/private-mode failures; `saveAsTemplate` sets `justSaved` unconditionally. Safari private mode: "Saved" shown, template gone on reload, no warning ever.
**Fix:** return a success boolean from `saveTemplates`; only confirm on success.

**N6. Composer/find inputs hand-roll styling instead of `@ds/Input`** — `client/src/screens/TerminalScreen.jsx:147-160, 216-231` · confidence 30 · Maintainer
`SessionsScreen` already uses `@ds/Input` for equivalent fields; low-stakes inconsistency limited to the two genuine text-entry fields (chips have hand-rolled precedent).

**N7. Templates persist with no lifecycle tie to auth revocation** — `client/src/core/templates.ts` · confidence 30 · Security
No client logout flow exists at all, and `ar-claude-*` keys share the characteristic — not a new boundary. Fold into the scoped-tokens / paired-device-dashboard backlog rather than fixing here.

### Summary

The pure-module extraction discipline mostly held (four new tested core modules), and the accepted-risk envelope was respected. The cluster that matters is delivery honesty under bad connectivity: W1 is the worst — the feature built for flaky mobile moments silently eats the operator's answer in exactly those moments — with W3 the same family. W2/W4/N5 are three small lies the template/save UI can tell; fix them together.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 70 | Composer clears text on silently-dropped send | fixed |
| W2 | WARNING | 70 | "Saved" indicator stale after form edit | fixed |
| W3 | WARNING | 55 | Find-bar match state survives buffer reset on reconnect | fixed |
| W4 | WARNING | 50 | Blank-name template saves silently overwrite each other | (open) |
| N2 | NOTE | 55 | Transcript now a durable artifact (acceptance note) | (open) |
| N3 | NOTE | 50 | `matchReadout` inline/untested vs core convention | (open) |
| N1 | NOTE | 45 | `.txt` transcript contains raw ANSI escapes | (open) |
| N4 | NOTE | 35 | No IME composition guard on Enter | (open) |
| N5 | NOTE | 35 | Failed localStorage write still shows "Saved" | (open) |
| N6 | NOTE | 30 | Inputs bypass `@ds/Input` | (open) |
| N7 | NOTE | 30 | Template store has no auth-lifecycle hook | (open) |

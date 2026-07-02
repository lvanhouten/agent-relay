## Adversarial Review: claude-model-effort-selection branch vs main

**Scope:** 3 code files changed (+~160 reviewable lines) across 1 commit (`2a71974`) — a new pure flag-splice module (`client/src/core/claudeFlags.ts` + `claudeFlags.test.ts`), model/effort chip rows and `localStorage` last-used defaults in the create dialog (`client/src/screens/SessionsScreen.jsx`), and an agent-facing prose update to `switchboard_new_line`'s `run` descriptor (`server/board/mcp-server.js`). Doc-only changes (`CLAUDE.md`, the feature's own issue doc) excluded from the budget.
**Reviewed:** `main..HEAD` = `2a71974` (single commit), working tree clean.
**Pre-checks:** `npm test --workspace=client` — 33/33 pass (incl. the new `claudeFlags.test.ts`, 15 cases); `npm run typecheck --workspace=client` (`tsc -p`, `strict`, scoped to `src/core`) — 0 errors. No mechanical issues open.
**Verdict:** CONCERNS

### Warnings

**W1. `setFlag` inserts the value verbatim — a `$` triggers `String.replace` substitution, and a value with a space round-trips lossily** — `client/src/core/claudeFlags.ts:39` · confidence 55

**Status:** ✅ Resolved in <W1 gate SHA>.
**Resolution:** Accepted as framed — both failure modes re-reproduced locally before fixing (`'a$&b'` → `'claude --model a --model xb'`; `'a b'` written unquoted). Fix: the replace path now uses a replacement *function* so `$` is literal text (defect 1), and both write paths re-quote a value containing whitespace (defect 2), closing the read/write asymmetry — what `getFlag` reads out of quotes, `setFlag` writes back into them. A value containing a double quote itself remains outside the module's shell-naive contract, now stated in the `setFlag` doc comment. Closure check: red→green — three new tests (`$` literal on both paths, whitespace re-quoting, full quoted read→write round trip) fail against the old implementation and pass now; suite 36/36.

---

`setFlag`'s two write paths both feed `value` straight into a replacement/template string with no escaping:

```ts
if (re.test(command)) return command.replace(re, ` --${name} ${value}`);   // replace path
return `${command.trimEnd()} --${name} ${value}`;                          // append path
```

Two distinct defects fall out, both **confirmed empirically** (ran `getFlag`/`setFlag` directly against the module):

1. **`$`-substitution corruption (replace path).** The second argument to `String.prototype.replace` is a *replacement pattern*, not a literal — `$&`, `$1`, `$\`` etc. are interpolated. A value containing `$` is expanded against the match:
   `setFlag('claude --model x', 'model', 'a$&b')` → `"claude --model a --model xb"` (the `$&` re-inserted the matched ` --model x`). The append path is a plain template literal and is immune, so the same value behaves differently depending on whether the flag was already present — a latent inconsistency inside the primitive.
2. **Quote-loss round-trip (read/write asymmetry).** `getFlag` *strips* quotes (`line 29`, with a dedicated test "quoted values come back unquoted"), but `setFlag` never *adds* them. So any value containing a space cannot survive a read→write cycle:
   `getFlag('claude --model "a b"', 'model')` → `"a b"`; `setFlag('claude', 'model', 'a b')` → `"claude --model a b"`; re-reading that yields `"a"`. The trailing token silently detaches.

Why it matters despite exotic triggers: this is exactly the round trip the shipped feature performs automatically. A user-typed quoted flag (`claude --model "a b"`) is read by `rememberClaudeDefaults` → `getFlag` → stored in `localStorage` → re-applied next open by `withClaudeDefaults` → `setFlag` — so an *inert quoted argument* (which the CLI would have rejected as one bad model value) is silently re-materialized as a **detached second token / active flag** the operator never re-typed. That's the Security lens's angle on the same root cause: a value that was contained inside `--model`'s argument escapes its quoting across the persist cycle.

The reason it isn't CRITICAL is that no real `--model` alias (`sonnet`/`opus`/`haiku`/`fable`, or a full `claude-*` id) or `--effort` level contains a space or `$`, and the chip options are a fixed single-token list — so the shipped UI paths never trigger it. But `client/src/core/` exists precisely as *reusable, debugged primitives*, the test suite implies robustness it doesn't have (it tests quoted **reads** but never a quoting-needed **write**), and the feature doc names a second consumer (spawn-templates phase 2 will migrate defaults into a server-side store through these same helpers). The next caller that passes an arbitrary string inherits the trap.

*Verdict basis:* CONFIRMED — both failure modes reproduced directly against the module. Maintainer lens (read/write asymmetry: `getFlag` strips what `setFlag` can't restore) and Saboteur lens (`$&` corruption + inert-arg→active-flag on round-trip) converge on one locus from different angles.

*Fix:* escape the value before it enters the replacement/append. Minimum: use a replacement *function* (`command.replace(re, () => \` --${name} ${value}\`)`) so `$` is treated literally, closing defect 1. For defect 2, either re-quote on write when the value contains whitespace, or state the single-token contract in code and have `getFlag` refuse to return a spaced value so the asymmetry can't round-trip. Add a `setFlag` test with a value that needs quoting and one containing `$` — the current suite would pass through both bugs.

### Notes

**N1. Re-clicking the already-lit `claude` quick-command chip destructively resets a hand-edited command** — `client/src/screens/SessionsScreen.jsx:192` · confidence 40

**Status:** ✅ Resolved in <N1 gate SHA>.
**Resolution:** Accepted as framed — the guard applied to the whole quick-command row (not just claude): clicking an already-selected chip is now a no-op, so a lit control can't destroy a hand-built command on a reassurance click. Selecting a *different* chip still replaces the command, which is that gesture's stated intent. Closure check: named guarded path — the `if (selected) return` in the chip's `pick` handler, with the comment naming the hazard; UI-only per repo convention (no component harness), suite stays 36/36.

---

The `claude` segmented button is rendered `selected` whenever `isClaudeCommand(command)` is true, but its `onClick` unconditionally runs `setCommand(withClaudeDefaults('claude'))`. So a user who has built up `claude --model opus "review the PR"` and then clicks the `claude` segment again — a natural "make sure it's selected" gesture on a lit control — loses the prompt and any hand-typed flags, silently replaced by `claude` + stored defaults. The model/effort chips below correctly splice in place (they preserve the rest); only the top quick-command row is destructive. A guard (`if (!isClaudeCommand(command)) setCommand(...)`, or leave an already-selected claude command untouched) would remove the footgun. Recoverable by retyping, hence NOTE.

**N2. A valid, CLI-accepted model/effort not in the chip list shows *no* chip selected — not even "default"** — `client/src/screens/SessionsScreen.jsx:62` · confidence 35

`FlagChipRow` computes `selected = current === value`, where `current = getFlag(command, flag)`. When the command carries a model the chips don't know (e.g. `claude --model claude-3-5-haiku-latest`, exactly the free-text-with-suggestions case the design doc blesses), `current` is a non-null string that matches neither the named options nor the `null` "default" chip — so the whole row renders with nothing lit. That reads as "no selection / broken" rather than "custom value active, see the command field." Consistent with the "chips are suggestions, field is source of truth" intent (so not a defect), but a maintainer/operator has no on-chip signal that a custom value is deliberately in play. A subtle "custom" affordance or a lit-but-unnamed state would resolve it; documented here as the most likely point of UI confusion.

**N3. Model/effort enumerations are now duplicated across three locations that will drift on the next Anthropic release** — `server/board/mcp-server.js:240` · confidence 40

The alias/effort lists now live in the client chips (`CLAUDE_MODELS`/`CLAUDE_EFFORTS`, `SessionsScreen.jsx:18-19`), the MCP `run` descriptor prose (`sonnet | opus | haiku | fable` and `low | medium | high | xhigh | max`, `mcp-server.js:240-241`), and the feature's own issue doc. The client arrays carry an explicit "suggestions, not validation — the CLI is the validator; a hardcoded list must never refuse what the CLI would accept" caveat (`SessionsScreen.jsx:14-17`); the MCP prose hardcodes the same lists as prescriptive agent guidance with no equivalent "this list rots" hedge and no shared constant (they're in different packages — client ESM vs. server board CJS — so sharing one isn't free). This is the exact rot the client code guards against, reintroduced one layer over in agent-facing text. Low-severity because both are advisory, but a `fable-2`/new-effort release will leave the MCP advice quietly stale while the client field still accepts the new value. Consider trimming the MCP prose to "an explicit `--model`/`--effort` sized to the job (see the CLI reference for current aliases)" rather than freezing the enumeration.

**N4. `isClaudeCommand` misses `claude.exe`/`claude.cmd` and any case variation — the model/effort chips silently vanish for a Windows-style invocation** — `client/src/core/claudeFlags.ts:16` · confidence 30

`/^\s*claude(\s|$)/` requires `claude` to be immediately followed by whitespace or end-of-string, and is case-sensitive. On Windows the CLI is frequently `claude.cmd`/`claude.exe`, and shells are case-insensitive; `isClaudeCommand('claude.cmd …')` and `isClaudeCommand('CLAUDE')` both return `false`, so the model/effort chip rows never appear and the defaults never apply for those invocations. The bare `claude` quick-chip always produces a matching string, so this only bites a user who hand-types a qualified/cased binary — hence low confidence. If broadened intentionally, mind the boundary the current regex enforces (`claudette` must stay excluded); a suffix like `(\.\w+)?` before the `(\s|$)` and an `i` flag would cover it without admitting `claudette`.

### Summary

The pure module and the chip UI do the hard part correctly — in-place single-flag splicing that preserves the rest of a hand-edited command, exactly as the design doc requires, with a solid 15-case test suite and clean typecheck. The one finding worth acting on is **W1**: `setFlag` inserts its value through `String.replace` semantics and cannot faithfully re-emit a value it earlier read with quotes stripped, so the automatic `localStorage` round-trip can turn an inert quoted argument into a detached token / active flag. It does not fire on any real model or effort value, so the shipped feature is low-risk to merge — but it's a latent trap in a primitive the feature doc explicitly plans to reuse, and cheap to close. Verdict is CONCERNS on the strength of that single confirmed warning (CLEAN's carve-out is only for sub-50 speculative warnings; W1 is confirmed at 55), not on breadth — the notes are polish.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 55 | `setFlag` inserts value verbatim — `$` hits String.replace substitution; spaced value round-trips lossily | (open) |
| N1 | NOTE | 40 | re-clicking the lit `claude` chip wipes a hand-edited command | (open) |
| N3 | NOTE | 40 | model/effort lists duplicated in MCP prose (drifts on next release) | (open) |
| N2 | NOTE | 35 | a CLI-valid model not in the chip list shows no chip selected | (open) |
| N4 | NOTE | 30 | `isClaudeCommand` misses `claude.exe`/`.cmd`/case variants | (open) |

## Review methodology

Run via the `adversarial-review` skill in **in-context mode** — the change is small (1 commit, 3 code files, ~160 reviewable lines) and low-stakes (client UI + a pure string helper + an MCP prose string; no DB, auth, or PHI surface), so the standing trio (Saboteur, Maintainer, Security Auditor) ran sequentially rather than as isolated subagents, and no conditional specialist was summoned. Constraints brief built from the feature's own design doc (`_docs/issues/2026-07-02-claude-model-effort-selection.md`), whose stated intent — chips are a structured editor over the command string, options are suggestions not validation, the CLI is the sole validator, `localStorage` defaults migrating to a server store in spawn-templates phase 2 — was treated as authoritative (so "the chip list doesn't validate model names" is by design, not a finding). Mechanical pre-checks (client tests, typecheck) run before the persona pass; W1's two failure modes were reproduced directly against the module before scoring.

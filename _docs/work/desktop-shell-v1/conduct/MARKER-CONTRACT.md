# Marker contract — for conducted Stage sessions

You are a **Stage session** in a conducted run. When your stage's work is complete,
your **final act** — after all other commits — is to write and commit a Marker file so
the Conductor knows you finished. This file tells you exactly how.

## Where

```
_docs/work/desktop-shell-v1/conduct/<stage-id>.done.json
```

`<stage-id>` is given to you in the prompt (one of: `execute-briefs`, `adversarial-review`,
`remediate-batch`, `verify`, `integrate`, `contract-check`).

## Schema

```json
{ "stage": "<stage-id>",
  "outcome": "green | exception",
  "artifact": "<path to this stage's primary artifact>",
  "summary": "<one line>",
  "asserted": false,
  "exceptions": [ { "kind": "<exception-kind>", "summary": "<one line>" } ] }
```

- `asserted` is always `false` (you never set it true — that is the Conductor's field).
- `exceptions` is `[]` when `outcome` is `green`.
- Write it, then **`git add` + `git commit` it** — the committed copy is the only signal
  the Conductor trusts. Committing is your final act; do not do more work after it.

## Per-stage outcome + exception semantics

| stage-id | `green` means | `exception` kind(s) it may report |
|---|---|---|
| `execute-briefs` | every ready brief reached `integrated` in briefs/STATUS.md | `blocked-brief`, `partial-brief` (one exceptions[] entry per such brief) |
| `adversarial-review` | the findings doc was written + committed (any verdict) | **none** — always `green` with a doc |
| `remediate-batch` | worker reached `completed` (all findings a verdict, incl. parked) | `parked-verdicts` (one entry per parked verdict-D / ambiguous finding) |
| `verify` | verification doc verdict is **CLEARED** | `not-cleared` (RESIDUE or REGRESSED) |
| `integrate` | merge landed, rebuild+retest green, worktree torn down | `integration-failed` (merge conflict or red gate) |
| `contract-check` | ledger verdict **DELIVERED** (or no contract — vacuous pass) | `undelivered-assertions` (one entry per undelivered live VC-n) |

## Cross-worktree note (remediate-batch only)

If you are `remediate-batch`: your annotated findings doc and fixes live in the isolated
remediation worktree, **not** merged to the feature branch. Your Marker's `artifact` must be
the **absolute path** to the annotated doc inside that worktree, and you must add a
`worktree` object:

```json
"worktree": { "path": "<worktreePath>", "branch": "<worktreeBranch>", "head": "<fix-head SHA>" }
```

But the Marker file **itself** is still written + committed to the feature worktree at the
path above (that is your `cwd`), so the Conductor can read it on the feature branch. Every
other stage omits `worktree` and uses a feature-worktree-relative `artifact`.

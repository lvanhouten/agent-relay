# Full-repo audit

Tracks a full-codebase adversarial review and batch remediation pass on
`chore/full-repo-audit`, run across three independent Claude Code sessions
(spawned via switchboard) so each phase stays blind to the ones before it:

1. `adversarial-review` — full-codebase pass (not a diff against `main`)
2. `remediate-batch` — fixes what it safely can in an isolated worktree
3. `adversarial-review --verify` — independent re-review of the fixes

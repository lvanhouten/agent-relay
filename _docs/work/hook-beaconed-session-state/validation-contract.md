# Validation Contract — hook-beaconed-session-state

Behavioral assertions defining feature-level done, authored implementation-blind from the PRD's user stories before any code exists. `prd-to-briefs` maps each brief to the `VC-n` ids it covers and fails slicing if any assertion is uncovered; `adversarial-review` sweeps promised-vs-delivered against these where present; a future conducted verify stage will record per-assertion status.

## Assertions

**VC-1.** After a session reports a SessionStart for its line, that line — while quiet and not waiting — is shown as *running*, not *quiet*.
**VC-2.** After a session reports a Stop for its line, and no further output has occurred, that line is shown as *turn done*.
**VC-3.** A *turn done* card is visually distinct from a *needs input* card by dot **color** (not motion alone) and from an *exited* tombstone (which lives in the recently-exited section), so the three states stay distinguishable at a glance, in a static screenshot, and with animation disabled.
**VC-4.** In the live sessions grid, *needs input* cards appear above *turn done* cards, which appear above all other live cards.
**VC-5.** A line shown as *turn done* returns to *running* as soon as the agent produces new output.
**VC-6.** When the operator sends input to a *turn done* line from the web terminal, the line stops being shown as *turn done*.
**VC-7.** When a line has both reported a Stop and been flagged as needing input, it is shown as *needs input* (needs input wins).
**VC-8.** A line whose session has never beaconed continues to derive its state from the idle heuristic (*running* while recently active, *quiet* once idle), unchanged by this feature.
**VC-9.** After the relay restarts, the next beacon from a still-live session re-establishes that line as a Claude line and restores its beacon-driven state.
**VC-10.** Posting a beacon does not send any push notification.
**VC-11.** A beacon with an unrecognized event, an oversized field, or a non-JSON body is rejected with a client error and changes no line's shown state.
**VC-12.** A beacon whose directory matches no live line changes no line's shown state and returns without error; a beacon whose line id names an exited line changes nothing and, in particular, never flags a *different* live line that shares its directory.
**VC-13.** A beacon posted while the board is unreachable results in a transient server-unavailable response, not a generic server error.
**VC-14.** A line that has exited continues to show as *exited*; a Stop beacon never causes an exited line to be shown as *turn done*.
**VC-15.** After a session reports a SessionEnd for its line, that live line reverts to the idle heuristic (*running* while recently active, *quiet* once idle) — it no longer shows *turn done* or a beacon-forced *running*.

## Drift discipline

When a brief legitimately deviates during build, the assertion it invalidates must be updated or consciously superseded — never silently dropped.

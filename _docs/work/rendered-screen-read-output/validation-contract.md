# Validation Contract — rendered-screen-read-output

Behavioral assertions defining feature-level done, authored implementation-blind from the PRD's user stories before any code exists. `prd-to-briefs` maps each brief to the `VC-n` ids it covers and fails slicing if any assertion is uncovered; `adversarial-review` sweeps promised-vs-delivered against these where present; a future conducted verify stage will record per-assertion status.

## Assertions

**VC-1.** Reading the rendered screen of a live line returns the current terminal grid as plain text with no ANSI escape sequences or cursor-control codes in it.

**VC-2.** For a line showing a selection menu with a highlight caret (e.g. `❯` on one option), the returned grid contains that caret positioned on the currently-highlighted option.

**VC-3.** After a keystroke changes which menu option is highlighted, a subsequent rendered-screen read shows the caret on the new option.

**VC-4.** The rendered-screen read returns the cursor's row and column and the grid's column and row dimensions alongside the grid text.

**VC-5.** Trailing whitespace on each row and trailing all-blank rows are absent from the returned grid, while leading and interior spacing that positions content is preserved.

**VC-6.** The size of a rendered-screen read is bounded by the terminal's dimensions regardless of how long the line has been running or how much output it has produced.

**VC-7.** Reading the rendered screen of a line whose terminal has been resized returns a grid whose dimensions match the line's current size, and content is laid out to that width (not sheared).

**VC-8.** `sb screen <id>` prints the current grid of the line to standard output as plain text with real line breaks and the highlight caret in place.

**VC-9.** Reading the rendered screen of a line that has already exited returns an error that identifies the line as ended and includes its exit code, not an empty or stale grid.

**VC-10.** Reading the rendered screen of an id that never existed returns an error identifying it as no such line — a message distinct from the ended-line error, so the two conditions are tellable apart.

**VC-11.** Reading raw output (the existing byte-stream delta read) is unchanged by this feature: a plain shell's linear output is still returned in order as the new-output delta, not replaced by a rendered grid.

## Drift discipline

When a brief legitimately deviates during build, the assertion it invalidates must be updated or consciously superseded — never silently dropped.

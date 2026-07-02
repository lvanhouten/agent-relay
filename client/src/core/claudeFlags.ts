// Pure helpers for reading/splicing `--flag value` pairs in a claude CLI
// command string. The create dialog's model/effort chips are a structured
// editor over the command field, not a separate source of truth: a chip click
// edits only its own flag in place (add / replace / remove), preserving
// whatever else the user typed — which is how the "never rewrite text the user
// has edited" rule and the last-writer-wins ambiguity both resolve (see
// _docs/issues/2026-07-02-claude-model-effort-selection.md).
//
// Deliberately shell-naive: values are matched as one quoted string or one
// bare token, which covers every real `--model`/`--effort` value. This is not
// a shell parser and must never validate values — the CLI is the validator.

// Does the model/effort axis apply? True for a command that invokes `claude`
// (optionally after whitespace), not for `claudette` or a path prefix.
export function isClaudeCommand(command: string): boolean {
  return /^\s*claude(\s|$)/.test(command);
}

// `--name value`, `--name=value`, or `--name "quoted value"`. The (?:=|\s+)
// separator doubles as the name boundary: `--models` never matches `--model`.
function flagWithValue(name: string): RegExp {
  return new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)("[^"]*"|'[^']*'|[^\\s]+)`);
}

// The flag's current value, quotes stripped, or null when absent.
export function getFlag(command: string, name: string): string | null {
  const m = command.match(flagWithValue(name));
  if (!m) return null;
  return m[1].replace(/^(["'])(.*)\1$/, '$2');
}

// Return the command with the flag set to `value`, or removed when `value` is
// null. Present flags are replaced in place; absent ones are appended. The
// removal match includes the flag's leading whitespace, so no space-collapse
// pass is needed (which would mangle runs of spaces inside quoted args).
export function setFlag(command: string, name: string, value: string | null): string {
  const re = new RegExp(`\\s*--${name}(?:=|\\s+)(?:"[^"]*"|'[^']*'|[^\\s]+)`);
  if (value === null) return command.replace(re, '');
  if (re.test(command)) return command.replace(re, ` --${name} ${value}`);
  return `${command.trimEnd()} --${name} ${value}`;
}

// Pure helpers for reading/splicing `--flag value` pairs in a claude CLI
// command string. The create dialog's model/effort chips edit only their own
// flag in place (add/replace/remove), preserving whatever else the user typed.
//
// Deliberately shell-naive: values match as one quoted string or one bare
// token — never a shell parser, never a validator (the CLI is).

// True for a command invoking `claude`, incl. Windows-qualified/cased forms
// (`claude.cmd`, `CLAUDE`) but not `claudette` or a path prefix — the (\s|$)
// boundary requires the binary name to end there.
export function isClaudeCommand(command: string): boolean {
  return /^\s*claude(\.\w+)?(\s|$)/i.test(command);
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

// Sets the flag to `value`, or removes it when `value` is null. Present flags
// are replaced in place; absent ones appended. The removal match includes the
// flag's leading whitespace, so no space-collapse pass is needed.
//
// Two write hazards guarded: the replacement is a function so a `$` in the
// value is literal text, never a String.replace substitution pattern; and a
// value containing whitespace is re-quoted on write, matching what getFlag
// read. A value containing a double quote is outside this module's shell-naive
// contract and unhandled.
export function setFlag(command: string, name: string, value: string | null): string {
  const re = new RegExp(`\\s*--${name}(?:=|\\s+)(?:"[^"]*"|'[^']*'|[^\\s]+)`);
  if (value === null) return command.replace(re, '');
  const token = /\s/.test(value) ? `"${value}"` : value;
  if (re.test(command)) return command.replace(re, () => ` --${name} ${token}`);
  return `${command.trimEnd()} --${name} ${token}`;
}

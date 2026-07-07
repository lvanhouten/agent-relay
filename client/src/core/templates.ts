// Spawn templates (phase 1, client-only): saved {name, cwd, command} shapes so
// re-spawning "Claude in agent-relay" is one tap instead of re-typing a Windows
// path on a soft keyboard. The array ops are pure and unit-tested here (the
// localStorage I/O is a thin wrapper below); load guards a corrupt/foreign store
// the same way wsFrame guards a bad frame — a hand-edited or partially-written
// value must never throw inside the create dialog's mount.
//
// A template is identified by its trimmed label: saving under an existing label
// overwrites it (an upsert), so "save as template" twice with the same name
// updates rather than duplicates. Phase 2 migrates this into the server-side
// store behind /api/templates so templates follow the operator across devices —
// see _docs/issues/2026-07-02-fleet-spawn-templates.md.

export interface SpawnTemplate {
  label: string;
  name: string;
  cwd: string;
  command: string;   // '' = plain shell (no initial command)
}

const KEY = 'ar-spawn-templates';

// A record survives parsing only if every field is a string. Anything else
// (an older/foreign shape, a truncated write) is dropped rather than trusted —
// a template drives command execution on tap, so a malformed one is discarded,
// not coerced.
function isTemplate(v: unknown): v is SpawnTemplate {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.label === 'string'
    && typeof t.name === 'string'
    && typeof t.cwd === 'string'
    && typeof t.command === 'string'
    && t.label.trim() !== '';
}

// Parse a raw localStorage string into a clean list. Returns [] for null,
// unparseable JSON, a non-array, or an array with no valid entries; keeps only
// the well-formed entries otherwise.
export function parseTemplates(raw: string | null): SpawnTemplate[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isTemplate);
}

export function serializeTemplates(list: SpawnTemplate[]): string {
  return JSON.stringify(list);
}

// Upsert by trimmed label: an existing entry with the same label is replaced in
// place (order preserved); a new label is appended. The stored label is the
// trimmed form so lookups and display agree.
export function upsertTemplate(list: SpawnTemplate[], tpl: SpawnTemplate): SpawnTemplate[] {
  const label = tpl.label.trim();
  const clean = { ...tpl, label };
  const idx = list.findIndex((t) => t.label === label);
  if (idx === -1) return [...list, clean];
  const next = list.slice();
  next[idx] = clean;
  return next;
}

export function removeTemplate(list: SpawnTemplate[], label: string): SpawnTemplate[] {
  return list.filter((t) => t.label !== label);
}

// Label fallback when the session-name field is blank: derive it from what the
// template actually does ("claude · agent-relay") instead of a literal
// 'template' — under which every blank-name save collided and silently
// overwrote the previous one. Content-derived labels make genuinely different
// templates distinct; two saves that DO produce the same label (same leading
// command word, same directory name) still upsert, which is the intended
// same-template re-save semantics.
export function fallbackLabel(cwd: string, command: string): string {
  const dir = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd.trim() || '~';
  const cmd = command.trim().split(/\s+/)[0] || 'shell';
  return `${cmd} · ${dir}`;
}

// --- localStorage wrappers (browser I/O over the pure ops above) ---

export function loadTemplates(): SpawnTemplate[] {
  try { return parseTemplates(localStorage.getItem(KEY)); } catch { return []; }
}

export function saveTemplates(list: SpawnTemplate[]): void {
  try { localStorage.setItem(KEY, serializeTemplates(list)); } catch { /* quota/private-mode — non-fatal */ }
}

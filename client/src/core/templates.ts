// Spawn templates (phase 1, client-only): saved {name, cwd, command} shapes so
// re-spawning "Claude in agent-relay" is one tap instead of retyping a path on
// a soft keyboard. load() must never throw on a corrupt/hand-edited store
// inside the create dialog's mount.
//
// Identified by trimmed label: saving under an existing label upserts, so
// "save as template" twice with the same name updates, not duplicates. Phase 2
// moves this server-side (/api/templates) so templates follow the operator
// across devices.

export interface SpawnTemplate {
  label: string;
  name: string;
  cwd: string;
  command: string;   // '' = plain shell (no initial command)
}

const KEY = 'ar-spawn-templates';

// Survives parsing only if every field is a string; anything else (an
// older/foreign shape, a truncated write) is dropped, not coerced — a
// template drives command execution on tap.
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

// Label fallback when the name field is blank: derive from what the template
// does ("claude · agent-relay") instead of a literal 'template', under which
// every blank-name save collided and silently overwrote the previous one.
// Two saves that DO produce the same label still upsert — the intended
// same-template re-save semantics.
export function fallbackLabel(cwd: string, command: string): string {
  const dir = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd.trim() || '~';
  const cmd = command.trim().split(/\s+/)[0] || 'shell';
  return `${cmd} · ${dir}`;
}

// fallbackLabel still collides when two DIFFERENT dirs share a basename and
// leading command ('/work/api' vs '/home/api' -> both 'claude · api'), which
// would silently replace a different template. Widen with the parent segment
// on such a clash (then the full cwd if that still collides); a clash with the
// SAME cwd keeps the base label — the intended re-save collapse.
export function uniqueFallbackLabel(list: SpawnTemplate[], cwd: string, command: string): string {
  const cmd = command.trim().split(/\s+/)[0] || 'shell';
  const segs = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter((s) => s);
  const candidates = [
    fallbackLabel(cwd, command),
    `${cmd} · ${segs.slice(-2).join('/')}`,
    `${cmd} · ${cwd}`,
  ];
  for (const label of candidates) {
    const clash = list.find((t) => t.label === label);
    if (!clash || clash.cwd === cwd) return label;
  }
  return candidates[candidates.length - 1];
}

// --- localStorage wrappers (browser I/O over the pure ops above) ---

export function loadTemplates(): SpawnTemplate[] {
  try { return parseTemplates(localStorage.getItem(KEY)); } catch { return []; }
}

// Returns whether the write persisted. Quota/private-mode failures are
// non-fatal, but the caller must know — else "Saved" lies about a template
// that's gone on reload.
export function saveTemplates(list: SpawnTemplate[]): boolean {
  try { localStorage.setItem(KEY, serializeTemplates(list)); return true; }
  catch { return false; }
}

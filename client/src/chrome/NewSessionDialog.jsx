import React from 'react';
import { Button } from '@ds/Button.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Input } from '@ds/Input.jsx';
import { isClaudeCommand, getFlag, setFlag } from '../core/claudeFlags.ts';
import { loadTemplates, saveTemplates, upsertTemplate, removeTemplate, uniqueFallbackLabel } from '../core/templates.ts';
import { Terminal, Folder, FolderSearch, Bookmark, BookmarkPlus, X } from 'lucide-react';
import { DirectoryPicker } from './DirectoryPicker.jsx';
import styles from './NewSessionDialog.module.scss';

// Shared new-session dialog — the one create surface both shells open (mobile:
// SessionsScreen; desktop: the workspace sidebar). Templates, claude model/effort
// chips, "save as template", and the stays-open-until-success contract all live
// here.

const QUICK_COMMANDS = ['claude', 'bash', 'zsh', 'powershell'];

// Suggestions, not validation: the command field stays the escape hatch for any
// model/effort name these chips don't know — the CLI is the validator, and a
// hardcoded list must never refuse what the CLI would accept (see
// _docs/issues/2026-07-02-claude-model-effort-selection.md).
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'fable'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Operator-wide defaults for Claude sessions: last-used values persist on a
// successful spawn (no separate settings UI) and prefill the next claude
// command. localStorage for now; migrates into the server-side store when
// spawn-templates phase 2 lands so the two share one persistence story.
function withClaudeDefaults(cmd) {
  const model = localStorage.getItem('ar-claude-model');
  const effort = localStorage.getItem('ar-claude-effort');
  let out = cmd;
  if (model) out = setFlag(out, 'model', model);
  if (effort) out = setFlag(out, 'effort', effort);
  return out;
}

export function rememberClaudeDefaults(command) {
  // Only a claude spawn updates the defaults — launching bash must not clear
  // them. A claude spawn with a flag omitted *does* clear that default: the
  // operator chose the CLI default, so remember the choice.
  if (!isClaudeCommand(command)) return;
  const model = getFlag(command, 'model');
  const effort = getFlag(command, 'effort');
  if (model) localStorage.setItem('ar-claude-model', model);
  else localStorage.removeItem('ar-claude-model');
  if (effort) localStorage.setItem('ar-claude-effort', effort);
  else localStorage.removeItem('ar-claude-effort');
}

// One row of flag chips — a structured editor over the command string. A chip
// click splices only its own flag (setFlag), so hand-typed text elsewhere in
// the command survives; "default" removes the flag (CLI config decides).
function FlagChipRow({ label, flag, options, command, onCommand }) {
  const current = getFlag(command, flag);
  const chips = [{ value: null, text: 'default' }, ...options.map((o) => ({ value: o, text: o }))];
  return (
    <div className={styles.flagChipRow}>
      <span className={styles.flagLabel}>
        {label}
      </span>
      {chips.map(({ value, text }) => {
        const selected = current === value;
        return (
          <button
            key={text}
            onClick={() => onCommand(setFlag(command, flag, value))}
            className={`${styles.flagChip} ${selected ? styles.flagChipSelected : ''}`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function NewSessionDialog({ onClose, onCreate, error, busy }) {
  const [name, setName] = React.useState('');
  const [cwd, setCwd] = React.useState('~/');
  const [command, setCommand] = React.useState(() => withClaudeDefaults('claude'));

  // Spawn templates (phase 1, localStorage). Loaded once on mount; the picker
  // prefills the form (prefill-and-edit, never fires blindly — a stale cwd must
  // be visible before spawn), and "save as template" upserts the current form.
  const [templates, setTemplates] = React.useState(loadTemplates);
  const [justSaved, setJustSaved] = React.useState(false);
  // The Working Directory field's "Browse…" affordance swaps the dialog body for
  // a folder picker (no stacked modal); "Use this folder" writes the path back.
  const [browsing, setBrowsing] = React.useState(false);

  // Every form edit goes through these, not the raw setters: any change
  // invalidates the "Saved" indicator — the stored template is the pre-edit
  // form, and the button must not claim the edited one is saved.
  const editName = (v) => { setName(v); setJustSaved(false); };
  const editCwd = (v) => { setCwd(v); setJustSaved(false); };
  const editCommand = (v) => { setCommand(v); setJustSaved(false); };

  const applyTemplate = (t) => {
    setName(t.name);
    setCwd(t.cwd);
    setCommand(t.command);
    setJustSaved(false);
  };

  const saveAsTemplate = () => {
    // The session name is the label — the operator already types a meaningful
    // one ("claude · agent-relay"); upsert dedupes so a re-save overwrites.
    // Blank name -> a content-derived label (core/templates.ts), widened with
    // path segments if it would clash with a different directory's template —
    // only a same-cwd re-save may upsert over an existing blank-name entry.
    const label = name.trim() || uniqueFallbackLabel(templates, cwd, command);
    const next = upsertTemplate(templates, {
      label, name: name.trim() || 'untitled', cwd, command: command.trim(),
    });
    setTemplates(next);
    // Only claim "Saved" when the localStorage write persisted — in private
    // mode / over quota the chip still works this session but is gone on
    // reload, and the accent state must not promise otherwise.
    setJustSaved(saveTemplates(next));
  };

  const deleteTemplate = (label) => {
    const next = removeTemplate(templates, label);
    setTemplates(next);
    saveTemplates(next);
  };

  const handleCreate = () => {
    onCreate({
      name: name.trim() || 'untitled',
      cwd,
      command: command.trim() || undefined, // optional; runs in the shell, which stays open
    });
  };

  return (
    <div onClick={onClose} className={styles.overlay}>
      <div onClick={(e) => e.stopPropagation()} className={styles.dialog}>
        <div className={styles.headerRow}>
          <h2 className={styles.title}>{browsing ? 'Choose a folder' : 'New session'}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <span className={styles.closeIcon}>×</span>
          </IconButton>
        </div>

        {browsing && (
          <DirectoryPicker
            initialPath={cwd}
            onPick={(p) => { editCwd(p); setBrowsing(false); }}
            onCancel={() => setBrowsing(false)}
          />
        )}

        {!browsing && (
        <>
        {templates.length > 0 && (
          <div className={styles.fieldGroup}>
            <span className={styles.sectionLabel}>
              Templates
            </span>
            <div className={styles.templateChipRow}>
              {templates.map((t) => (
                // Load-on-tap; the trailing × removes without loading. Each chip
                // is one saved {name, cwd, command} shape.
                <span key={t.label} className={styles.templateChip}>
                  <button
                    type="button"
                    onClick={() => applyTemplate(t)}
                    title={`${t.command || 'plain shell'} · ${t.cwd}`}
                    className={styles.templateChipButton}
                  >
                    <Bookmark size={12} /> {t.label}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete template ${t.label}`}
                    title="Delete template"
                    onClick={() => deleteTemplate(t.label)}
                    className={styles.templateChipDelete}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <Input
          label="Session name"
          value={name}
          onChange={(e) => editName(e.target.value)}
          placeholder="api-dev"
          autoFocus
        />
        <Input
          label="Working directory"
          mono
          value={cwd}
          onChange={(e) => editCwd(e.target.value)}
          prefix={<Folder size={14} />}
          suffix={
            <button
              type="button"
              className={styles.browseButton}
              onClick={() => setBrowsing(true)}
              aria-label="Browse folders"
              title="Browse folders"
            >
              <FolderSearch size={16} />
            </button>
          }
        />

        <div className={styles.fieldGroup}>
          <span className={styles.sectionLabel}>
            Initial command
          </span>
          <div className={styles.quickCommandsRow}>
            {QUICK_COMMANDS.map((c) => {
              // The claude chip stays lit while flags ride the command — the
              // model/effort chips below edit the same string. Re-clicking it
              // while lit is a no-op: a hand-built claude command (flags, a
              // quoted prompt) must not be wiped by a "make sure it's
              // selected" click on an already-selected control.
              const selected = c === 'claude' ? isClaudeCommand(command) : command === c;
              const pick = () => {
                if (selected) return;
                editCommand(c === 'claude' ? withClaudeDefaults('claude') : c);
              };
              return (
                <button
                  key={c}
                  onClick={pick}
                  className={`${styles.quickCommandChip} ${selected ? styles.quickCommandChipSelected : ''}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          {isClaudeCommand(command) && (
            <>
              <FlagChipRow label="model" flag="model" options={CLAUDE_MODELS} command={command} onCommand={editCommand} />
              <FlagChipRow label="effort" flag="effort" options={CLAUDE_EFFORTS} command={command} onCommand={editCommand} />
            </>
          )}
          <Input
            mono
            value={command}
            onChange={(e) => editCommand(e.target.value)}
            placeholder="npm run dev — leave blank for a plain shell"
          />
          <div className={styles.commandFooterRow}>
            <span className={styles.hintText}>
              Runs on start; the shell stays open when it exits.
            </span>
            <button
              type="button"
              onClick={saveAsTemplate}
              title="Save this name, directory, and command as a reusable template"
              className={`${styles.saveTemplateButton} ${justSaved ? styles.saveTemplateButtonSaved : ''}`}
            >
              <BookmarkPlus size={13} /> {justSaved ? 'Saved' : 'Save as template'}
            </button>
          </div>
        </div>

        {error && (
          <p className={styles.errorText}>
            {error}
          </p>
        )}

        <div className={styles.actionsRow}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={busy} leadingIcon={<Terminal size={15} />} onClick={handleCreate}>
            Create &amp; attach
          </Button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

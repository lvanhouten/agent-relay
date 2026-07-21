import React from 'react';
import { Button } from '@shared/Button.jsx';
import { IconButton } from '@shared/IconButton.jsx';
import { Input } from '@shared/Input.jsx';
import { isClaudeCommand, getFlag, setFlag } from '../core/claudeFlags.ts';
import { loadTemplates, saveTemplates, upsertTemplate, removeTemplate, uniqueFallbackLabel } from '../core/templates.ts';
import { Terminal, Folder, FolderSearch, Bookmark, BookmarkPlus, X } from 'lucide-react';
import { DirectoryPicker } from './DirectoryPicker.jsx';
import styles from './NewSessionDialog.module.scss';

// The one create surface both shells open (mobile: SessionsScreen; desktop:
// the sidebar). Stays open until create succeeds.

const QUICK_COMMANDS = ['claude', 'bash', 'zsh', 'powershell'];

// Suggestions, not validation: the command field is the escape hatch for any
// model/effort name these chips don't know — the CLI is the validator, so this
// list must never refuse what the CLI would accept.
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'fable'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

// Last-used model/effort persist to localStorage on a successful spawn and prefill next time.
function withClaudeDefaults(cmd) {
  const model = localStorage.getItem('ar-claude-model');
  const effort = localStorage.getItem('ar-claude-effort');
  let out = cmd;
  if (model) out = setFlag(out, 'model', model);
  if (effort) out = setFlag(out, 'effort', effort);
  return out;
}

export function rememberClaudeDefaults(command) {
  // Only a claude spawn updates defaults (bash must not clear them); an omitted
  // flag on a claude spawn does clear its default, since the operator chose the CLI default.
  if (!isClaudeCommand(command)) return;
  const model = getFlag(command, 'model');
  const effort = getFlag(command, 'effort');
  if (model) localStorage.setItem('ar-claude-model', model);
  else localStorage.removeItem('ar-claude-model');
  if (effort) localStorage.setItem('ar-claude-effort', effort);
  else localStorage.removeItem('ar-claude-effort');
}

// A chip click splices only its own flag, so hand-typed text elsewhere in the
// command survives; "default" removes the flag (CLI config decides).
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

export function NewSessionDialog({ onClose, onCreate, error, busy, initialCwd }) {
  const [name, setName] = React.useState('');
  // '~/' is the from-scratch default; read once since the dialog remounts per open.
  const [cwd, setCwd] = React.useState(initialCwd || '~/');
  const [command, setCommand] = React.useState(() => withClaudeDefaults('claude'));

  // Spawn templates (phase 1, localStorage): picker prefills the form (edit before spawn,
  // never fires blindly), "save as template" upserts the current form.
  const [templates, setTemplates] = React.useState(loadTemplates);
  const [justSaved, setJustSaved] = React.useState(false);
  // "Browse…" swaps the dialog body for a folder picker (no stacked modal).
  const [browsing, setBrowsing] = React.useState(false);

  // Any edit invalidates "Saved" — the stored template is the pre-edit form.
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
    // Blank name falls back to a content-derived label, disambiguated by cwd if needed.
    const label = name.trim() || uniqueFallbackLabel(templates, cwd, command);
    const next = upsertTemplate(templates, {
      label, name: name.trim() || 'untitled', cwd, command: command.trim(),
    });
    setTemplates(next);
    // "Saved" only claims true once the localStorage write actually persisted.
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
              // Re-clicking the already-selected claude chip is a no-op, so a hand-built
              // command (flags, a quoted prompt) can't be wiped by it.
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

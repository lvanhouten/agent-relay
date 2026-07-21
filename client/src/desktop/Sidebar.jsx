import React from 'react';
import { Button } from '@shared/Button.jsx';
import { Badge } from '@shared/Badge.jsx';
import { StatusDot } from '@shared/StatusDot.jsx';
import { IconButton } from '@shared/IconButton.jsx';
import { Input } from '@shared/Input.jsx';
import { attentionFor } from '../core/attention.ts';
import { tombstoneView } from '../core/tombstoneView.ts';
import { Plus, Search, Folder, Trash2, X, ChevronRight, ChevronDown, Sun, Moon, Smartphone, Bell, BellOff, ArrowRightToLine } from 'lucide-react';
import styles from './Sidebar.module.scss';

// Attention dot uses the SAME decode as the mobile cards (core/attention.ts),
// so a needs-input flag pulses identically on both. Alt+N chord shown for rows 1-9.
function SessionRow({ session, index, selected, onSelect, onInject, onKill }) {
  const attention = attentionFor(session.status);
  const preview = session.preview ?? [];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(session.id); } }}
      className={`${styles.row}${selected ? ' ' + styles.rowSelected : ''}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className={styles.rowTop}>
        {/* Additive action on the LEFT, terminate on the far right, so a cheap
            "watch this" click can't be mistaken for the destructive kill. */}
        <span className={styles.rowInject}>
          <IconButton label="Add to grid" size="sm" onClick={(e) => { e.stopPropagation(); onInject(session.id); }}>
            <ArrowRightToLine size={13} />
          </IconButton>
        </span>
        <StatusDot status={attention.dot} size="sm" showLabel={false} pulse={attention.pulse} />
        <span className={styles.rowName}>{session.name}</span>
        {index < 9 && <span className={styles.jump}>⌥{index + 1}</span>}
        <span className={styles.rowKill}>
          <IconButton label="Terminate" size="sm" onClick={(e) => { e.stopPropagation(); onKill(session.id); }}>
            <Trash2 size={13} />
          </IconButton>
        </span>
      </div>
      <span className={styles.rowCwd}>
        <Folder size={11} />
        <span className={styles.rowCwdPath}>{session.cwd}</span>
      </span>
      {/* Decorative rendered-screen tail; hidden from the accessibility tree. */}
      {preview.length > 0 && (
        <pre className={styles.rowPreview} aria-hidden="true">{preview.join('\n')}</pre>
      )}
    </div>
  );
}

function TombstoneRow({ session, onDismiss }) {
  const { dot, label, failed } = tombstoneView(session);
  return (
    <div className={styles.tombstoneRow}>
      <StatusDot status={dot} size="sm" showLabel={false} pulse={false} />
      <span className={styles.tombstoneMain}>
        <span className={styles.rowName}>{session.name}</span>
        <span className={styles.rowHint}>{session.cwd}</span>
      </span>
      <Badge variant={failed ? 'danger' : 'neutral'}>{label}</Badge>
      <IconButton label="Dismiss" size="sm" onClick={() => onDismiss(session.id)}>
        <X size={13} />
      </IconButton>
    </div>
  );
}

const NOTIFY = {
  on: { icon: Bell, label: 'Disable notifications', active: true, disabled: false },
  off: { icon: BellOff, label: 'Enable notifications', active: false, disabled: false },
  blocked: { icon: BellOff, label: 'Notifications blocked in browser settings', active: false, disabled: true },
  unsupported: { icon: BellOff, label: 'Notifications unavailable', active: false, disabled: true },
};

export function Sidebar({
  liveSessions, endedSessions, liveCount, selectedId, home,
  query, onQuery, onHome, onSelect, onInject, onKill, onDismiss, onNewSession,
  theme, onToggleTheme, onToggleShell, notifyView, onToggleNotify,
}) {
  const [showEnded, setShowEnded] = React.useState(false);
  const bell = NOTIFY[notifyView] ?? NOTIFY.off;
  const BellIcon = bell.icon;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <button
          className={`${styles.brand}${home ? ' ' + styles.brandActive : ''}`}
          onClick={onHome}
          aria-current={home ? 'true' : undefined}
          title="Fleet overview"
        >
          <span className={styles.brandMark}>▸</span>
          agent-relay
        </button>
        <span className={styles.count}>{liveCount} live</span>
      </div>

      <div className={styles.controls}>
        <Button fullWidth leadingIcon={<Plus size={15} />} onClick={onNewSession}>
          New session
        </Button>
        <Input
          prefix={<Search size={14} />}
          placeholder="Filter sessions"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>

      <div className={styles.list}>
        {liveSessions.length === 0 ? (
          <div className={styles.empty}>
            {liveCount === 0 ? 'No active sessions.' : `No sessions match "${query}".`}
          </div>
        ) : (
          liveSessions.map((s, i) => (
            <SessionRow
              key={s.id}
              session={s}
              index={i}
              selected={s.id === selectedId}
              onSelect={onSelect}
              onInject={onInject}
              onKill={onKill}
            />
          ))
        )}
      </div>

      {endedSessions.length > 0 && (
        <div className={styles.tombstones}>
          <button className={styles.tombstoneHeader} onClick={() => setShowEnded((v) => !v)}>
            {showEnded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Recently exited ({endedSessions.length})
          </button>
          {showEnded && (
            <div className={styles.tombstoneList}>
              {endedSessions.map((s) => (
                <TombstoneRow key={s.id} session={s} onDismiss={onDismiss} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className={styles.footer}>
        <IconButton label="Switch to mobile layout" onClick={onToggleShell}>
          <Smartphone size={16} />
        </IconButton>
        <IconButton
          label={bell.label}
          active={bell.active}
          disabled={bell.disabled}
          aria-pressed={bell.active}
          onClick={onToggleNotify}
        >
          <BellIcon size={16} />
        </IconButton>
        <span className={styles.footerSpacer} />
        <IconButton label="Toggle theme" onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
      </div>
    </aside>
  );
}

import React from 'react';
import QRCode from 'qrcode';
import { Button } from '@shared/Button.jsx';
import { Card } from '@shared/Card.jsx';
import { Badge } from '@shared/Badge.jsx';
import { StatusDot } from '@shared/StatusDot.jsx';
import { IconButton } from '@shared/IconButton.jsx';
import { OverflowMenu } from '@shared/OverflowMenu.jsx';
import { Input } from '@shared/Input.jsx';
import { attentionFor, attentionRank } from '../core/attention.ts';
import { tombstoneView } from '../core/tombstoneView.ts';
import { getPairing } from '../core/api.ts';
import { pairingDisplay } from '../core/pairingDisplay.ts';
import { useFullscreen } from '../core/useFullscreen.ts';
import { useVisibleActionCount } from '../core/useVisibleActionCount.ts';
import { Folder, Clock, Trash2, Plus, Search, Settings, Sun, Moon, Monitor, X, ChevronRight, ChevronDown, QrCode, Maximize2, Minimize2 } from 'lucide-react';
import styles from './SessionsScreen.module.scss';

function SessionCard({ session, onAttach, onKill }) {
  // Status decode lives in core/attention.ts, the vocabulary sync point with
  // server/src/sessions.js.
  const attention = attentionFor(session.status);
  const pulse = attention.pulse;
  const preview = session.preview ?? [];
  return (
    <Card interactive padding="md" onClick={() => onAttach(session)}
      className={styles.cardBody}>
      <div className={styles.cardHeader}>
        <span className={styles.cardName}>
          <StatusDot status={attention.dot} size="sm" showLabel={false} pulse={pulse} />
          {session.name}
        </span>
        <IconButton label="Terminate" size="sm" onClick={(e) => { e.stopPropagation(); onKill(session.id); }}>
          <Trash2 size={14} />
        </IconButton>
      </div>
      <span className={styles.cardCwd}>
        <Folder size={12} />
        <span className={styles.cardCwdPath}>{session.cwd}</span>
      </span>

      {/* Decorative echo of the line's tail rows; name/cwd/status carry the
          semantics, hence aria-hidden. */}
      {preview.length > 0 && (
        <pre className={styles.cardPreview} aria-hidden="true">{preview.join('\n')}</pre>
      )}

      <div className={styles.cardFooter}>
        <div className={styles.cardBadges}>
          <Badge variant="neutral">pid {session.pid}</Badge>
        </div>
        {/* State word + time read as one clause; both derive from the same
            server-side idle clock. */}
        <span className={styles.cardMeta}>
          <StatusDot status={attention.dot} pulse={pulse} size="sm" label={attention.label} />
          <span className={styles.cardTime}>
            <Clock size={11} /> {session.lastActive}
          </span>
        </span>
      </div>
    </Card>
  );
}

// A tombstone card for a capped-ring recently-ended line. Not attachable (the
// data pipe is gone) - dismiss is the only action, and drops it via the same
// DELETE the kill button uses (the server falls through to `forget`).
function ExitedSessionCard({ session, onDismiss }) {
  // Tombstone decode is centralized in core/tombstoneView.ts, shared with the
  // sidebar row and detail pane so all three agree.
  const { dot, label, failed } = tombstoneView(session);
  return (
    <Card padding="md" className={`${styles.cardBody} ${styles.exitedBody}`}>
      <div className={styles.cardHeader}>
        <span className={styles.cardName}>
          <StatusDot status={dot} pulse={false} size="sm" showLabel={false} />
          {session.name}
        </span>
        <IconButton label="Dismiss" size="sm" onClick={() => onDismiss(session.id)}>
          <X size={14} />
        </IconButton>
      </div>
      <span className={styles.cardCwd}>
        <Folder size={12} />
        <span className={styles.cardCwdPath}>{session.cwd}</span>
      </span>

      <div className={styles.cardFooter}>
        <div className={styles.cardBadges}>
          <Badge variant={failed ? 'danger' : 'neutral'}>{label}</Badge>
        </div>
        <span className={styles.exitedTime}>
          <Clock size={11} /> {session.lastActive}
        </span>
      </div>
    </Card>
  );
}

// "Pair a device" dialog. Fetches GET /api/pairing only while mounted, so the
// credential-bearing pairingUrl is discarded on close, not cached in app
// state. Status -> display fan-out lives in core/pairingDisplay.ts.
function PairDeviceDialog({ onClose }) {
  const [info, setInfo] = React.useState(null); // PairingInfo | null, from core/types.ts
  const [error, setError] = React.useState('');
  const [qrDataUrl, setQrDataUrl] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    getPairing()
      .then((data) => { if (!cancelled) setInfo(data); })
      .catch(() => { if (!cancelled) setError('Could not reach the server to fetch pairing info.'); });
    return () => { cancelled = true; };
  }, []);

  const pairingUrl = info?.pairingUrl ?? null;

  React.useEffect(() => {
    if (!pairingUrl) { setQrDataUrl(''); return; }
    let cancelled = false;
    QRCode.toDataURL(pairingUrl, { margin: 1, width: 224 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setError('Could not render the pairing QR code.'); });
    return () => { cancelled = true; };
  }, [pairingUrl]);

  const display = info ? pairingDisplay(info) : null;

  return (
    <div onClick={onClose} className={styles.overlay}>
      <div onClick={(e) => e.stopPropagation()} className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Pair a device</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <span className={styles.closeGlyph}>×</span>
          </IconButton>
        </div>

        {error && (
          <p className={styles.errorText}>
            {error}
          </p>
        )}

        {!error && !info && (
          <p className={styles.checkingText}>
            Checking tunnel status…
          </p>
        )}

        {!error && display && (
          <div className={styles.qrSection}>
            <span className={styles.qrHeading}>
              {display.heading}
            </span>

            {display.showQr && pairingUrl ? (
              <>
                {/* QR needs a light, high-contrast background regardless of app theme. */}
                <div className={styles.qrBox}>
                  {qrDataUrl
                    ? <img src={qrDataUrl} width={200} height={200} alt="Pairing QR code — scan with the device you want to pair" />
                    : <span className={styles.qrPlaceholder}>Rendering…</span>}
                </div>
                <code className={styles.pairingUrl}>
                  {pairingUrl}
                </code>
              </>
            ) : (
              <p className={styles.messageText}>
                {display.message}
              </p>
            )}
          </div>
        )}

        <div className={styles.modalActions}>
          <Button fullWidth variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export default function SessionsScreen({
  host, theme, onToggleTheme, onToggleShell, onAttach, sessions, onKill, onNewSession,
}) {
  // Presenter over MobileShell's data layer (sessions/onKill/create dialog);
  // owns only its own presentation state (filter, pairing, fullscreen).
  const [query, setQuery] = React.useState('');
  const [pairOpen, setPairOpen] = React.useState(false);
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const actionsRowRef = React.useRef(null);

  const [showEnded, setShowEnded] = React.useState(false);

  const filtered = sessions.filter((s) =>
    `${s.name} ${s.cwd}`.toLowerCase().includes(query.toLowerCase())
  );
  // GET /sessions returns live + tombstoned lines in one array; tombstones get
  // their own collapsed section and the header count stays live-only.
  // attentionRank floats needs-input/turn-done to the top (stable sort keeps
  // poll order within a rank tier).
  const live = filtered
    .filter((s) => s.status !== 'exited')
    .sort((a, b) => attentionRank(a.status) - attentionRank(b.status));
  const ended = filtered.filter((s) => s.status === 'exited');
  const liveCount = sessions.filter((s) => s.status !== 'exited').length;

  // Same priority-order + overflow pattern as TerminalScreen's header actions -
  // settings is reached for least, so it's first into the menu.
  const actions = [
    { key: 'pair', label: 'Pair a device', menuLabel: 'Pair a device', onClick: () => setPairOpen(true), icon: <QrCode size={16} /> },
    { key: 'fullscreen', label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen', menuLabel: isFullscreen ? 'Exit fullscreen' : 'Fullscreen', active: isFullscreen, onClick: toggleFullscreen, icon: isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} /> },
    ...(onToggleShell ? [{ key: 'shell', label: 'Switch to desktop layout', menuLabel: 'Switch to desktop layout', onClick: onToggleShell, icon: <Monitor size={16} /> }] : []),
    { key: 'theme', label: 'Toggle theme', menuLabel: 'Toggle theme', onClick: onToggleTheme, icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} /> },
    { key: 'settings', label: 'Settings', menuLabel: 'Settings', onClick: () => {}, icon: <Settings size={16} /> },
  ];
  const visibleActionCount = useVisibleActionCount(actionsRowRef, actions.length);
  const visibleActions = actions.slice(0, visibleActionCount);
  const overflowActions = actions.slice(visibleActionCount);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <span className={styles.logoMark}>▸</span>
          agent-relay
        </span>
        {/* Only flex-grow item in the row - see TerminalScreen's header. */}
        <div ref={actionsRowRef} className={styles.actionsRow}>
          {visibleActions.map((a) => (
            <IconButton key={a.key} label={a.label} active={a.active} onClick={a.onClick}>
              {a.icon}
            </IconButton>
          ))}
        </div>
        {/* Always reserved, whether or not the menu has anything in it. */}
        <div className={styles.overflowSlot}>
          <OverflowMenu items={overflowActions} />
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.topBar}>
          <div>
            <span className={styles.sectionLabel}>
              Active sessions
            </span>
            <h1 className={styles.pageTitle}>
              {liveCount} session{liveCount === 1 ? '' : 's'} on{' '}
              <span className={styles.accentWord}>main</span>
            </h1>
          </div>
          <div className={styles.controlsRow}>
            <div className={styles.searchBox}>
              <Input
                prefix={<Search size={14} />}
                placeholder="Filter sessions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button leadingIcon={<Plus size={15} />} onClick={onNewSession}>
              New session
            </Button>
          </div>
        </div>

        {live.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateText}>
              {liveCount === 0
                ? 'No active sessions. Start one to get going.'
                : `No sessions match "${query}".`}
            </div>
          </div>
        ) : (
          <div className={styles.sessionsGrid}>
            {live.map((s) => (
              <SessionCard key={s.id} session={s} onAttach={onAttach} onKill={onKill} />
            ))}
          </div>
        )}

        {ended.length > 0 && (
          <section className={styles.endedSection}>
            <button onClick={() => setShowEnded((v) => !v)} className={styles.endedToggle}>
              {showEnded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Recently exited ({ended.length})
            </button>
            {showEnded && (
              <div className={`${styles.sessionsGrid} ${styles.sessionsGridEnded}`}>
                {ended.map((s) => (
                  <ExitedSessionCard key={s.id} session={s} onDismiss={onKill} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Mounted only while open - state discards on close, never lifted here. */}
      {pairOpen && <PairDeviceDialog onClose={() => setPairOpen(false)} />}
    </div>
  );
}

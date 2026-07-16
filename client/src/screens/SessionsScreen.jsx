import React from 'react';
import QRCode from 'qrcode';
import { Button } from '@ds/Button.jsx';
import { Card } from '@ds/Card.jsx';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { OverflowMenu } from '@ds/OverflowMenu.jsx';
import { Input } from '@ds/Input.jsx';
import { attentionFor, attentionRank } from '../core/attention.ts';
import { tombstoneView } from '../core/tombstoneView.ts';
import { getPairing } from '../core/api.ts';
import { pairingDisplay } from '../core/pairingDisplay.ts';
import { useFullscreen } from '../core/useFullscreen.ts';
import { useVisibleActionCount } from '../core/useVisibleActionCount.ts';
import { Folder, Clock, Trash2, Plus, Search, Settings, Sun, Moon, Monitor, X, ChevronRight, ChevronDown, QrCode, Maximize2, Minimize2 } from 'lucide-react';
import styles from './SessionsScreen.module.scss';

// The session card renders no scrollback preview: the server DTO carries no
// `preview` field (neither toDto() nor spawn() in server/src/sessions.js
// populate one). The data exists one layer down (the board keeps a
// 2000-chunk scrollback per line), so this can be revived by exposing a
// scrollback tail through the board's `list` reply and threading it into
// toDto(). Deferred as a feature, not a bug — see
// _docs/issues/2026-07-01-session-card-live-preview.md.

function SessionCard({ session, onAttach, onKill }) {
  const shellLabel = session.shell.split(/[/\\]/).pop();
  // status decode lives in core/attention.ts (the vocabulary sync point with
  // server/src/sessions.js) — see the rationale + tests there.
  const attention = attentionFor(session.status);
  const pulse = attention.pulse;
  return (
    <Card interactive padding="md" onClick={() => onAttach(session)}
      className={styles.cardBody}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleBlock}>
          <span className={styles.cardName}>
            <StatusDot status={attention.dot} size="sm" showLabel={false} pulse={pulse} />
            {session.name}
          </span>
          <span className={styles.cardCwd}>
            <Folder size={12} /> {session.cwd}
          </span>
        </div>
        <IconButton label="Terminate" size="sm" onClick={(e) => { e.stopPropagation(); onKill(session.id); }}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <div className={styles.cardFooter}>
        <div className={styles.cardBadges}>
          <Badge variant="accent">{shellLabel}</Badge>
          <Badge variant="neutral">pid {session.pid}</Badge>
        </div>
        {/* State word + relative time read as one clause ("quiet · 43s ago") —
            the state is literally derived from that same idle clock server-side. */}
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

// A tombstone card: the board keeps a capped ring of recently-ended lines so an
// unattended exit doesn't just vanish from the poll. Not attachable (the data
// pipe is gone) — the only action is dismiss, which drops the tombstone via the
// same DELETE the kill button uses (the server falls through to `forget`).
function ExitedSessionCard({ session, onDismiss }) {
  const shellLabel = session.shell.split(/[/\\]/).pop();
  // Tombstone decode (dot color, crash predicate, status word) is centralized in
  // core/tombstoneView.ts — the one place a `reason`/`exitCode` becomes a
  // rendering, shared with the sidebar row and detail pane so the three agree.
  const { dot, label, failed } = tombstoneView(session);
  return (
    <Card padding="md" className={`${styles.cardBody} ${styles.exitedBody}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleBlock}>
          <span className={styles.cardName}>
            <StatusDot status={dot} pulse={false} size="sm" showLabel={false} />
            {session.name}
          </span>
          <span className={styles.cardCwd}>
            <Folder size={12} /> {session.cwd}
          </span>
        </div>
        <IconButton label="Dismiss" size="sm" onClick={() => onDismiss(session.id)}>
          <X size={14} />
        </IconButton>
      </div>

      <div className={styles.cardFooter}>
        <div className={styles.cardBadges}>
          <Badge variant="neutral">{shellLabel}</Badge>
          <Badge variant={failed ? 'danger' : 'neutral'}>{label}</Badge>
        </div>
        <span className={styles.exitedTime}>
          <Clock size={11} /> {session.lastActive}
        </span>
      </div>
    </Card>
  );
}

// "Pair a device" dialog. Fetches GET /api/pairing on open (not
// on page load — this component only mounts while the dialog is open, so its
// state — including the credential-bearing pairingUrl — is discarded on close
// rather than cached in the screen/app state) and renders a client-side QR
// (qrcode package) when the tunnel is up. Status -> display fan-out lives in
// core/pairingDisplay.ts; this stays a thin render over that + the QR image.
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
                {/* QR modules need a light, high-contrast background regardless
                    of the app theme, hence the fixed white box. */}
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
  // Presenter over the shell-owned data layer: `sessions`, `onKill`, and the
  // create dialog (opened via onNewSession) all live in MobileShell. This screen
  // owns only its own presentation state (filter, pairing, fullscreen).
  const [query, setQuery] = React.useState('');
  const [pairOpen, setPairOpen] = React.useState(false);
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const actionsRowRef = React.useRef(null);

  const [showEnded, setShowEnded] = React.useState(false);

  const filtered = sessions.filter((s) =>
    `${s.name} ${s.cwd}`.toLowerCase().includes(query.toLowerCase())
  );
  // The list carries live sessions and recently-ended tombstones in one array
  // (both come from GET /sessions); the tombstones render in their own
  // collapsed section, and the header count stays live-only. needs-input and
  // turn-done cards float to the top via core/attention.ts's attentionRank —
  // the whole point of those states is "which session needs me?", so a
  // blocked or finished session shouldn't hide below a screen of running
  // ones. Array#sort is stable, so the poll order is preserved within each
  // rank tier.
  const live = filtered
    .filter((s) => s.status !== 'exited')
    .sort((a, b) => attentionRank(a.status) - attentionRank(b.status));
  const ended = filtered.filter((s) => s.status === 'exited');
  const liveCount = sessions.filter((s) => s.status !== 'exited').length;

  // Same priority-order + overflow pattern as TerminalScreen's header actions —
  // settings is the one operators reach for least, so it's first into the menu.
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
        {/* The only flex-grow item in the row - see TerminalScreen's header for
            why its resolved clientWidth is exactly "room CSS gave the buttons". */}
        <div ref={actionsRowRef} className={styles.actionsRow}>
          {visibleActions.map((a) => (
            <IconButton key={a.key} label={a.label} active={a.active} onClick={a.onClick}>
              {a.icon}
            </IconButton>
          ))}
        </div>
        {/* Always reserved, whether or not the menu has anything in it - see
            TerminalScreen's header for why. */}
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

      {/* Mounted only while open — its own state (including the
          credential-bearing pairing URL) is discarded on close, never lifted
          into this screen's state. */}
      {pairOpen && <PairDeviceDialog onClose={() => setPairOpen(false)} />}
    </div>
  );
}

import React from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { X } from 'lucide-react';
import { TerminalView } from '../core/TerminalView.tsx';
import { attentionFor } from '../core/attention.ts';
import { paneRows } from '../core/gridPanes.ts';
import styles from './PaneGrid.module.scss';

// One grid cell: a slim header (attention dot, name, interactive badge, remove)
// over a TerminalView. The focused cell is interactive; the rest are spectators
// that adopt the reported PTY dims and CSS-scale. `mode` is a live
// prop, NOT part of the key: the pane must NOT remount on focus change, or the
// data pipe tears down and re-runs the reconstructed replay — which corrupts a
// long session's history. TerminalView reconfigures interactive/spectator in
// place (a `mode` frame to the server, no reattach).
function PaneCell({ session, focused, theme, onFocus, onRemove }) {
  const attention = attentionFor(session.status);
  return (
    <div
      className={`${styles.cell}${focused ? ' ' + styles.cellFocused : ''}`}
      onMouseDown={() => { if (!focused) onFocus(session.id); }}
    >
      <div className={styles.bar}>
        <StatusDot status={attention.dot} size="sm" showLabel={false} pulse={attention.pulse} />
        <span className={styles.name}>{session.name}</span>
        <span className={styles.spacer} />
        {focused && <span className={styles.badge}>interactive</span>}
        <IconButton label="Remove from grid" size="sm" onClick={(e) => { e.stopPropagation(); onRemove(session.id); }}>
          <X size={13} />
        </IconButton>
      </div>
      <TerminalView
        key={session.id}
        sessionId={session.id}
        theme={theme}
        mode={focused ? 'interactive' : 'spectator'}
        cols={session.cols}
        rows={session.rows}
      />
    </div>
  );
}

// The spectator pane grid: N live sessions side by side in resizable splits
// (react-resizable-panels), arranged into roughly-square rows by paneRows. One
// pane is focused/interactive; clicking any other focuses it. Panes and byId are
// owned by DesktopWorkspace; this component only lays them out.
export function PaneGrid({ panes, byId, focusedId, theme, onFocus, onRemove }) {
  const rows = paneRows(panes);
  return (
    <section className={styles.grid}>
      <Group orientation="vertical" className={styles.group}>
        {rows.map((row, r) => (
          <React.Fragment key={r}>
            {r > 0 && <Separator className={styles.handleRow} />}
            <Panel minSize="10">
              <Group orientation="horizontal" className={styles.group}>
                {row.map((id, c) => (
                  <React.Fragment key={id}>
                    {c > 0 && <Separator className={styles.handleCol} />}
                    <Panel minSize="10">
                      <PaneCell
                        session={byId.get(id)}
                        focused={id === focusedId}
                        theme={theme}
                        onFocus={onFocus}
                        onRemove={onRemove}
                      />
                    </Panel>
                  </React.Fragment>
                ))}
              </Group>
            </Panel>
          </React.Fragment>
        ))}
      </Group>
    </section>
  );
}

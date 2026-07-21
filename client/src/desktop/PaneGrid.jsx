import React from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { StatusDot } from '@shared/StatusDot.jsx';
import { IconButton } from '@shared/IconButton.jsx';
import { X } from 'lucide-react';
import { TerminalView } from '../core/TerminalView.tsx';
import { attentionFor } from '../core/attention.ts';
import { paneRows } from '../core/gridPanes.ts';
import styles from './PaneGrid.module.scss';

// `mode` is a live prop, NOT part of the key: remounting on focus change would tear
// down the data pipe and re-run the replay, corrupting a long session's history.
// TerminalView reconfigures interactive/spectator in place instead.
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

// N live sessions in resizable splits, arranged into roughly-square rows by
// paneRows. Panes and byId are owned by DesktopWorkspace; this only lays them out.
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

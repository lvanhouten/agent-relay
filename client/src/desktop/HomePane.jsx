import React from 'react';
import { Button } from '@shared/Button.jsx';
import { StatusDot } from '@shared/StatusDot.jsx';
import { Terminal as TerminalIcon, Plus, ChevronRight } from 'lucide-react';
import { attentionFor } from '../core/attention.ts';
import { fleetSummary } from '../core/fleetSummary.ts';
import styles from './HomePane.module.scss';

// Neutral landing place when no session is selected: a fleet-wide overview
// the narrow sidebar list can't give at a glance.

// Breakdown chips, in attention precedence; each maps to the shared status dot
// so a category reads the same color here as on a row.
const BREAKDOWN = [
  { key: 'needsInput', dot: 'attention', label: 'needs input', pulse: true },
  { key: 'turnDone', dot: 'done', label: 'turn done', pulse: false },
  { key: 'running', dot: 'online', label: 'running', pulse: false },
  { key: 'quiet', dot: 'idle', label: 'quiet', pulse: false },
];

export function HomePane({ sessions, onSelect, onNewSession }) {
  const summary = fleetSummary(sessions);

  if (summary.live === 0) {
    return (
      <section className={styles.home}>
        <div className={styles.empty}>
          <TerminalIcon size={32} className={styles.emptyIcon} />
          <span>No active sessions. Start one to get going.</span>
          <Button leadingIcon={<Plus size={15} />} onClick={onNewSession}>New session</Button>
        </div>
      </section>
    );
  }

  // One-tap jumps for sessions needing attention: a blocked prompt or a finished turn.
  const attention = sessions.filter((s) => s.status === 'needs-input' || s.status === 'turn-done');

  return (
    <section className={styles.home}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <span className={styles.mark}>▸</span>
          <div className={styles.headText}>
            <h1 className={styles.title}>agent-relay</h1>
            <p className={styles.subtitle}>
              {summary.live} live session{summary.live === 1 ? '' : 's'}
              {summary.exited > 0 && <span className={styles.exited}> · {summary.exited} recently exited</span>}
            </p>
          </div>
          <Button leadingIcon={<Plus size={15} />} onClick={onNewSession}>New session</Button>
        </header>

        <div className={styles.chips}>
          {BREAKDOWN.filter((b) => summary[b.key] > 0).map((b) => (
            <div key={b.key} className={styles.chip}>
              <StatusDot status={b.dot} size="sm" showLabel={false} pulse={b.pulse} />
              <span className={styles.chipCount}>{summary[b.key]}</span>
              <span className={styles.chipLabel}>{b.label}</span>
            </div>
          ))}
        </div>

        {attention.length > 0 && (
          <div className={styles.attention}>
            <h2 className={styles.sectionTitle}>Needs your attention</h2>
            <div className={styles.attentionList}>
              {attention.map((s) => {
                const a = attentionFor(s.status);
                return (
                  <button key={s.id} className={styles.attentionRow} onClick={() => onSelect(s.id)}>
                    <StatusDot status={a.dot} size="sm" showLabel={false} pulse={a.pulse} />
                    <span className={styles.attentionMain}>
                      <span className={styles.attentionName}>{s.name}</span>
                      <span className={styles.attentionHint}>{s.cwd}</span>
                    </span>
                    <span className={styles.attentionBadge}>{a.label}</span>
                    <ChevronRight size={15} className={styles.attentionChevron} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

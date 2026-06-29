import * as React from 'react';

export type SessionStatus = 'online' | 'idle' | 'offline' | 'error';

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Connection state. @default 'offline' */
  status?: SessionStatus;
  /** Dot size. @default 'md' */
  size?: 'sm' | 'md';
  /** Emit a radar pulse. Defaults to true when status is 'online'. */
  pulse?: boolean;
  /** Override the auto label text. */
  label?: string;
  /** Show the text label beside the dot. @default true */
  showLabel?: boolean;
}

/**
 * Connection-state indicator for sessions and the relay host — the brand's
 * signature "signal" element.
 *
 * @startingPoint section="Core" subtitle="Session connection state — online / idle / offline" viewport="700x140"
 */
export function StatusDot(props: StatusDotProps): React.ReactElement;

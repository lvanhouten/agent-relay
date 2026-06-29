import * as React from 'react';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Render a key combo (joined with "+"). Omit and use children for a single key. */
  keys?: string[];
}

/** Keyboard key / shortcut hint. */
export function Kbd(props: KbdProps): React.ReactElement;

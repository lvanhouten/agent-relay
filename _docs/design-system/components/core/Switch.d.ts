import * as React from 'react';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Controlled checked state. */
  checked?: boolean;
  /** Optional text label rendered after the toggle. */
  label?: string;
}

/** Binary toggle for settings (theme, auto-reconnect, read-only mode). */
export function Switch(props: SwitchProps): React.ReactElement;

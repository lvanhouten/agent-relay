import * as React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default 'primary' */
  variant?: ButtonVariant;
  /** Control height. @default 'md' */
  size?: ButtonSize;
  /** Icon element rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Icon element rendered after the label. */
  trailingIcon?: React.ReactNode;
  /** Shows a spinner and disables interaction. @default false */
  loading?: boolean;
  /** Stretch to fill the container width. @default false */
  fullWidth?: boolean;
}

/**
 * Primary action control for agent-relay.
 *
 * @startingPoint section="Core" subtitle="Action button — primary, secondary, ghost, danger" viewport="700x180"
 */
export function Button(props: ButtonProps): React.ReactElement;

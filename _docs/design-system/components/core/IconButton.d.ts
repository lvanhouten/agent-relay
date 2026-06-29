import * as React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Control size. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Render a visible border + card background (use on toolbars over busy surfaces). @default false */
  bordered?: boolean;
  /** Active/toggled state (accent tint). @default false */
  active?: boolean;
  /** Accessible label — required since the button has no text. */
  label: string;
}

/** Square, icon-only control for toolbars and dense UI. */
export function IconButton(props: IconButtonProps): React.ReactElement;

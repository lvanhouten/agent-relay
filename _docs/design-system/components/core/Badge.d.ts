import * as React from 'react';

export type BadgeVariant =
  | 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
  | 'solid' | 'outline';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Color treatment. @default 'neutral' */
  variant?: BadgeVariant;
}

/** Compact mono label for counts, shells, statuses and tags. */
export function Badge(props: BadgeProps): React.ReactElement;

import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Inner padding. @default 'md' */
  padding?: 'sm' | 'md' | 'lg';
  /** Remove the resting shadow. @default false */
  flat?: boolean;
  /** Hover lift + accent border (use for clickable session cards). @default false */
  interactive?: boolean;
  /** Selected state — accent border + glow. @default false */
  selected?: boolean;
  /** Render as a different element/tag. @default 'div' */
  as?: keyof JSX.IntrinsicElements;
}

/** Surface container for sessions, panels and grouped content. */
export function Card(props: CardProps): React.ReactElement;

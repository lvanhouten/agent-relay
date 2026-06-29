import * as React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  /** Uppercase mono field label rendered above the input. */
  label?: string;
  /** Control height. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Element rendered inside the field, before the text (e.g. an icon). */
  prefix?: React.ReactNode;
  /** Element rendered inside the field, after the text. */
  suffix?: React.ReactNode;
  /** Error message — shown in danger color, sets aria-invalid. */
  error?: string;
  /** Helper text shown below when there is no error. */
  hint?: string;
  /** Render the typed value in the mono font (host names, tokens, paths). @default false */
  mono?: boolean;
}

/** Single-line text field with label, affixes and error/hint states. */
export function Input(props: InputProps): React.ReactElement;

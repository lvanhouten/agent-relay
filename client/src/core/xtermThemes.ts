import type { ITheme } from '@xterm/xterm';

// xterm color themes keyed by the app theme ('dark' | 'light'). Values mirror
// the design tokens in src/styles/tokens/ — xterm can't read CSS
// custom properties, so they're duplicated here as literals.
//
// The scrollbar slider (xterm v6's scrollback thumb) is themed fully transparent
// in both palettes: the relay watches self-contained TUIs (Claude Code renders
// inline, so every redraw frame lands in scrollback and the slider just scrolls
// back through stale frames). Wheel-scroll and scrollback still work — only the
// visual thumb is suppressed. See _docs/issues (desktop spectator panes).
const HIDDEN_SLIDER = {
  scrollbarSliderBackground: 'rgba(0, 0, 0, 0)',
  scrollbarSliderHoverBackground: 'rgba(0, 0, 0, 0)',
  scrollbarSliderActiveBackground: 'rgba(0, 0, 0, 0)',
} as const;

export const XTERM_THEMES: Record<string, ITheme> = {
  dark: {
    ...HIDDEN_SLIDER,
    background: '#070b0e',
    foreground: '#d8dee2',
    cursor: '#1fce8a',
    cursorAccent: '#070b0e',
    selectionBackground: 'rgba(31, 206, 138, 0.2)',
    black: '#11161a', brightBlack: '#353c41',
    red: '#f4675f',   brightRed: '#f4675f',
    green: '#1fce8a', brightGreen: '#54dfa6',
    yellow: '#f3b13c',brightYellow: '#f3b13c',
    blue: '#5aa6f0',  brightBlue: '#5aa6f0',
    magenta: '#c084fc',brightMagenta: '#e879f9',
    cyan: '#8aa0b2',  brightCyan: '#b0c4d4',
    white: '#d8dee2', brightWhite: '#fafbfb',
  },
  light: {
    ...HIDDEN_SLIDER,
    background: '#e9edee',
    foreground: '#2a3239',
    cursor: '#0c7650',
    cursorAccent: '#e9edee',
    selectionBackground: 'rgba(12, 118, 80, 0.2)',
    black: '#2a3239', brightBlack: '#4d555b',
    red: '#c02720',   brightRed: '#e23b34',
    green: '#0c7650', brightGreen: '#0e9462',
    yellow: '#b9790f',brightYellow: '#e0991f',
    blue: '#1f6bc0',  brightBlue: '#2f86e0',
    magenta: '#9333ea',brightMagenta: '#a855f7',
    cyan: '#2c6586',  brightCyan: '#1e7a9e',
    white: '#4d555b', brightWhite: '#21272b',
  },
};

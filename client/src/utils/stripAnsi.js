// Strips ANSI/VT100 escape sequences from raw PTY output
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g;

export const stripAnsi = (str) => str.replace(ANSI_RE, '').replace(/\r/g, '');

// Vite handles CSS side-effect imports (e.g. @xterm/xterm/css/xterm.css);
// this ambient declaration just keeps tsc from rejecting them.
declare module '*.css';

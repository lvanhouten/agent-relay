// Vite handles CSS side-effect imports (e.g. @xterm/xterm/css/xterm.css);
// this ambient declaration just keeps tsc from rejecting them.
declare module '*.css';

// CSS/SCSS Modules resolve to a class-name map (default export). Screens stay
// JSX (unchecked), but core/ is typechecked, so its module imports need a type.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

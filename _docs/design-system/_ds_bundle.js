/* @ds-bundle: {"format":3,"namespace":"AgentRelayDesignSystem_9f29b7","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Kbd","sourcePath":"components/core/Kbd.jsx"},{"name":"StatusDot","sourcePath":"components/core/StatusDot.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"b066971b61d5","components/core/Button.jsx":"65de2236b5d2","components/core/Card.jsx":"f1f52f8a5e1c","components/core/IconButton.jsx":"1b8c83bd1ea0","components/core/Input.jsx":"de2d3c72eff9","components/core/Kbd.jsx":"62bd64e49ce0","components/core/StatusDot.jsx":"4166464e3c9a","components/core/Switch.jsx":"bbd4c2cd3421","ui_kits/agent-relay/Chrome.jsx":"4715cf436f26","ui_kits/agent-relay/LoginScreen.jsx":"edc24aa26215","ui_kits/agent-relay/SessionsScreen.jsx":"4103847fa8a1","ui_kits/agent-relay/TerminalScreen.jsx":"1847ad9fe812","ui_kits/agent-relay/icons.jsx":"f5324efa6468"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AgentRelayDesignSystem_9f29b7 = window.AgentRelayDesignSystem_9f29b7 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-badge{display:inline-flex;align-items:center;gap:var(--space-1);
    font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:var(--weight-medium);
    letter-spacing:var(--tracking-wide);text-transform:uppercase;
    padding:2px var(--space-2);border-radius:var(--radius-sm);
    border:var(--border-1) solid transparent;line-height:1.4;white-space:nowrap;}
  .rl-badge--neutral{background:var(--surface-sunken);color:var(--text-body);border-color:var(--border-subtle);}
  .rl-badge--accent{background:var(--accent-soft);color:var(--text-accent);border-color:var(--border-accent);}
  .rl-badge--success{background:var(--success-soft);color:var(--success);}
  .rl-badge--warning{background:var(--warning-soft);color:var(--warning);}
  .rl-badge--danger{background:var(--danger-soft);color:var(--danger);}
  .rl-badge--info{background:var(--info-soft);color:var(--info);}
  .rl-badge--solid{background:var(--accent);color:var(--text-on-accent);border-color:transparent;}
  .rl-badge--outline{background:transparent;color:var(--text-muted);border-color:var(--border-default);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'badge');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Badge — compact mono label for counts, statuses, shells, and tags. */
function Badge({
  variant = 'neutral',
  className = '',
  children,
  ...rest
}) {
  useStyles();
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `rl-badge rl-badge--${variant} ${className}`.trim()
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useRelayButtonStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-btn{
    display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);
    font-family:var(--font-sans);font-weight:var(--weight-medium);
    border:var(--border-1) solid transparent;border-radius:var(--radius-md);
    cursor:pointer;white-space:nowrap;text-decoration:none;
    transition:background var(--dur-fast) var(--ease-out),
               border-color var(--dur-fast) var(--ease-out),
               color var(--dur-fast) var(--ease-out),
               box-shadow var(--dur-fast) var(--ease-out),
               transform var(--dur-fast) var(--ease-out);
  }
  .rl-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-btn:active{transform:translateY(1px);}
  .rl-btn[disabled],.rl-btn[aria-disabled="true"]{opacity:.5;cursor:not-allowed;transform:none;}

  /* sizes */
  .rl-btn--sm{height:var(--control-h-sm);padding:0 var(--space-3);font-size:var(--text-sm);}
  .rl-btn--md{height:var(--control-h-md);padding:0 var(--space-4);font-size:var(--text-base);}
  .rl-btn--lg{height:var(--control-h-lg);padding:0 var(--space-5);font-size:var(--text-md);}

  /* variants */
  .rl-btn--primary{background:var(--accent);color:var(--text-on-accent);}
  .rl-btn--primary:hover:not([disabled]){background:var(--accent-hover);}
  .rl-btn--primary:active:not([disabled]){background:var(--accent-active);}

  .rl-btn--secondary{background:var(--surface-card);color:var(--text-strong);border-color:var(--border-default);}
  .rl-btn--secondary:hover:not([disabled]){background:var(--surface-sunken);border-color:var(--border-strong);}

  .rl-btn--ghost{background:transparent;color:var(--text-body);}
  .rl-btn--ghost:hover:not([disabled]){background:var(--surface-sunken);color:var(--text-strong);}

  .rl-btn--danger{background:var(--danger);color:#fff;}
  .rl-btn--danger:hover:not([disabled]){filter:brightness(0.93);}

  .rl-btn__spinner{width:14px;height:14px;border-radius:50%;
    border:2px solid currentColor;border-right-color:transparent;
    animation:rl-btn-spin .6s linear infinite;}
  @keyframes rl-btn-spin{to{transform:rotate(360deg);}}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'button');
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * Button — the primary action control across agent-relay.
 */
function Button({
  variant = 'primary',
  size = 'md',
  leadingIcon = null,
  trailingIcon = null,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  useRelayButtonStyles();
  const cls = `rl-btn rl-btn--${variant} rl-btn--${size}${fullWidth ? ' rl-btn--block' : ''} ${className}`.trim();
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    className: cls,
    disabled: disabled || loading,
    style: fullWidth ? {
      width: '100%'
    } : undefined
  }, rest), loading && /*#__PURE__*/React.createElement("span", {
    className: "rl-btn__spinner",
    "aria-hidden": "true"
  }), !loading && leadingIcon, children, !loading && trailingIcon);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-card{background:var(--surface-card);border:var(--border-1) solid var(--border-subtle);
    border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);
    transition:border-color var(--dur-base) var(--ease-out),
               box-shadow var(--dur-base) var(--ease-out),
               transform var(--dur-base) var(--ease-out);}
  .rl-card--pad-sm{padding:var(--space-4);}
  .rl-card--pad-md{padding:var(--space-5);}
  .rl-card--pad-lg{padding:var(--space-6);}
  .rl-card--flat{box-shadow:none;}
  .rl-card--interactive{cursor:pointer;}
  .rl-card--interactive:hover{border-color:var(--border-accent);box-shadow:var(--shadow-md);transform:translateY(-2px);}
  .rl-card--interactive:active{transform:translateY(0);}
  .rl-card--selected{border-color:var(--border-accent);box-shadow:var(--glow-accent);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'card');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Card — surface container for sessions, panels and grouped content. */
function Card({
  padding = 'md',
  flat = false,
  interactive = false,
  selected = false,
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}) {
  useStyles();
  const cls = `rl-card rl-card--pad-${padding}${flat ? ' rl-card--flat' : ''}${interactive ? ' rl-card--interactive' : ''}${selected ? ' rl-card--selected' : ''} ${className}`.trim();
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-iconbtn{display:inline-flex;align-items:center;justify-content:center;
    border:var(--border-1) solid transparent;border-radius:var(--radius-md);
    background:transparent;color:var(--text-muted);cursor:pointer;
    transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),
               border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out);}
  .rl-iconbtn:hover:not([disabled]){background:var(--surface-sunken);color:var(--text-strong);}
  .rl-iconbtn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-iconbtn:active:not([disabled]){transform:translateY(1px);}
  .rl-iconbtn[disabled]{opacity:.45;cursor:not-allowed;}
  .rl-iconbtn--sm{width:28px;height:28px;}
  .rl-iconbtn--md{width:36px;height:36px;}
  .rl-iconbtn--lg{width:44px;height:44px;}
  .rl-iconbtn--bordered{border-color:var(--border-default);background:var(--surface-card);}
  .rl-iconbtn--bordered:hover:not([disabled]){border-color:var(--border-strong);}
  .rl-iconbtn--active{background:var(--accent-soft);color:var(--text-accent);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'iconbutton');
  el.textContent = css;
  document.head.appendChild(el);
}

/** IconButton — square, icon-only control for toolbars and dense UI. */
function IconButton({
  size = 'md',
  bordered = false,
  active = false,
  label,
  className = '',
  children,
  ...rest
}) {
  useStyles();
  const cls = `rl-iconbtn rl-iconbtn--${size}${bordered ? ' rl-iconbtn--bordered' : ''}${active ? ' rl-iconbtn--active' : ''} ${className}`.trim();
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: cls,
    "aria-label": label,
    title: label
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-field{display:flex;flex-direction:column;gap:var(--space-2);}
  .rl-field__label{font-family:var(--font-mono);font-size:var(--text-2xs);
    font-weight:var(--weight-medium);letter-spacing:var(--tracking-label);
    text-transform:uppercase;color:var(--text-muted);}
  .rl-input-wrap{display:flex;align-items:center;gap:var(--space-2);
    background:var(--surface-card);border:var(--border-1) solid var(--border-default);
    border-radius:var(--radius-md);padding:0 var(--space-3);
    transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out);}
  .rl-input-wrap--sm{height:var(--control-h-sm);}
  .rl-input-wrap--md{height:var(--control-h-md);}
  .rl-input-wrap--lg{height:var(--control-h-lg);}
  .rl-input-wrap:focus-within{border-color:var(--border-accent);box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-input-wrap--error{border-color:var(--danger);}
  .rl-input-wrap--error:focus-within{box-shadow:0 0 0 3px var(--danger-soft);}
  .rl-input-wrap--mono .rl-input{font-family:var(--font-mono);}
  .rl-input{flex:1;min-width:0;border:none;background:transparent;outline:none;
    font-family:var(--font-sans);font-size:var(--text-base);color:var(--text-strong);
    height:100%;padding:0;}
  .rl-input::placeholder{color:var(--text-faint);}
  .rl-input-affix{display:inline-flex;align-items:center;color:var(--text-faint);flex-shrink:0;}
  .rl-field__hint{font-size:var(--text-xs);color:var(--text-muted);}
  .rl-field__hint--error{color:var(--danger);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'input');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Input — single-line text field with label, affixes, and error/hint states. */
function Input({
  label,
  size = 'md',
  prefix = null,
  suffix = null,
  error = '',
  hint = '',
  mono = false,
  id,
  className = '',
  ...rest
}) {
  useStyles();
  const autoId = React.useId();
  const fieldId = id || autoId;
  const wrapCls = `rl-input-wrap rl-input-wrap--${size}${error ? ' rl-input-wrap--error' : ''}${mono ? ' rl-input-wrap--mono' : ''}`;
  return /*#__PURE__*/React.createElement("div", {
    className: `rl-field ${className}`.trim()
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "rl-field__label",
    htmlFor: fieldId
  }, label), /*#__PURE__*/React.createElement("div", {
    className: wrapCls
  }, prefix && /*#__PURE__*/React.createElement("span", {
    className: "rl-input-affix"
  }, prefix), /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    className: "rl-input",
    "aria-invalid": !!error
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    className: "rl-input-affix"
  }, suffix)), error ? /*#__PURE__*/React.createElement("span", {
    className: "rl-field__hint rl-field__hint--error"
  }, error) : hint && /*#__PURE__*/React.createElement("span", {
    className: "rl-field__hint"
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Kbd.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-kbd{display:inline-flex;align-items:center;justify-content:center;
    font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:var(--weight-medium);
    color:var(--text-body);background:var(--surface-card);
    border:var(--border-1) solid var(--border-default);
    border-bottom-width:2px;border-radius:var(--radius-sm);
    min-width:20px;height:20px;padding:0 5px;line-height:1;}
  .rl-kbd-group{display:inline-flex;align-items:center;gap:4px;
    font-family:var(--font-mono);font-size:var(--text-2xs);color:var(--text-faint);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'kbd');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Kbd — renders a keyboard key, or a combo when given an array of keys. */
function Kbd({
  keys,
  className = '',
  children,
  ...rest
}) {
  useStyles();
  if (Array.isArray(keys)) {
    return /*#__PURE__*/React.createElement("span", _extends({
      className: `rl-kbd-group ${className}`.trim()
    }, rest), keys.map((k, i) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, i > 0 && /*#__PURE__*/React.createElement("span", null, "+"), /*#__PURE__*/React.createElement("kbd", {
      className: "rl-kbd"
    }, k))));
  }
  return /*#__PURE__*/React.createElement("kbd", _extends({
    className: `rl-kbd ${className}`.trim()
  }, rest), children);
}
Object.assign(__ds_scope, { Kbd });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Kbd.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusDot.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-status{display:inline-flex;align-items:center;gap:var(--space-2);
    font-family:var(--font-mono);font-size:var(--text-2xs);
    letter-spacing:var(--tracking-label);text-transform:uppercase;
    font-weight:var(--weight-medium);color:var(--text-muted);}
  .rl-status__dot{position:relative;display:inline-block;border-radius:50%;flex-shrink:0;}
  .rl-status__dot--sm{width:7px;height:7px;}
  .rl-status__dot--md{width:9px;height:9px;}
  .rl-status--online .rl-status__dot{background:var(--status-online);}
  .rl-status--idle   .rl-status__dot{background:var(--status-idle);}
  .rl-status--offline .rl-status__dot{background:var(--status-offline);}
  .rl-status--error  .rl-status__dot{background:var(--status-error);}
  .rl-status--online  { color:var(--text-accent); }
  .rl-status__dot--pulse::after{content:"";position:absolute;inset:0;border-radius:50%;
    background:inherit;animation:rl-pulse 1.8s var(--ease-out) infinite;}
  @keyframes rl-pulse{0%{transform:scale(1);opacity:.6;}70%{transform:scale(2.6);opacity:0;}100%{opacity:0;}}
  @media (prefers-reduced-motion: reduce){.rl-status__dot--pulse::after{animation:none;}}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'statusdot');
  el.textContent = css;
  document.head.appendChild(el);
}
const DEFAULT_LABELS = {
  online: 'online',
  idle: 'idle',
  offline: 'offline',
  error: 'error'
};

/** StatusDot — connection state indicator for sessions and the relay host. */
function StatusDot({
  status = 'offline',
  size = 'md',
  pulse,
  label,
  showLabel = true,
  className = '',
  ...rest
}) {
  useStyles();
  const doPulse = pulse ?? status === 'online';
  const text = label ?? DEFAULT_LABELS[status] ?? status;
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `rl-status rl-status--${status} ${className}`.trim()
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: `rl-status__dot rl-status__dot--${size}${doPulse ? ' rl-status__dot--pulse' : ''}`
  }), showLabel && /*#__PURE__*/React.createElement("span", null, text));
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-switch{display:inline-flex;align-items:center;gap:var(--space-3);cursor:pointer;
    font-family:var(--font-sans);font-size:var(--text-base);color:var(--text-body);}
  .rl-switch input{position:absolute;opacity:0;width:0;height:0;}
  .rl-switch__track{position:relative;flex-shrink:0;width:38px;height:22px;border-radius:var(--radius-full);
    background:var(--border-default);transition:background var(--dur-base) var(--ease-out);}
  .rl-switch__thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
    background:#fff;box-shadow:var(--shadow-sm);
    transition:transform var(--dur-base) var(--ease-snap);}
  .rl-switch input:checked + .rl-switch__track{background:var(--accent);}
  .rl-switch input:checked + .rl-switch__track .rl-switch__thumb{transform:translateX(16px);}
  .rl-switch input:focus-visible + .rl-switch__track{box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-switch--disabled{opacity:.5;cursor:not-allowed;}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'switch');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Switch — binary toggle for settings (theme, auto-reconnect, read-only). */
function Switch({
  checked,
  defaultChecked,
  onChange,
  disabled = false,
  label,
  id,
  className = '',
  ...rest
}) {
  useStyles();
  const autoId = React.useId();
  const fieldId = id || autoId;
  return /*#__PURE__*/React.createElement("label", {
    className: `rl-switch${disabled ? ' rl-switch--disabled' : ''} ${className}`.trim(),
    htmlFor: fieldId
  }, /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    type: "checkbox",
    role: "switch",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "rl-switch__track"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rl-switch__thumb"
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// ui_kits/agent-relay/Chrome.jsx
try { (() => {
// Shared brand chrome for the agent-relay UI kit: BrandLogo + TopBar.
const {
  IconButton
} = window.AgentRelayDesignSystem_9f29b7;
function BrandLogo({
  size = 24,
  showWord = true
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      color: 'var(--text-strong)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none",
    style: {
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "24",
    cy: "24",
    r: "4.5",
    fill: "var(--accent)"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13 31.5 A 12 12 0 0 1 13 16.5",
    stroke: "var(--accent)",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M35 16.5 A 12 12 0 0 1 35 31.5",
    stroke: "var(--relay-300)",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeOpacity: "0.85"
  })), showWord && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 16,
      fontWeight: 700,
      letterSpacing: '-0.02em'
    }
  }, "agent", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      opacity: 0.5
    }
  }, "-relay")));
}
function TopBar({
  host,
  theme,
  onToggleTheme,
  right
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 56,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: '0 var(--space-5)',
      background: 'var(--surface-card)',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement(BrandLogo, null), host && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      marginLeft: 'var(--space-3)',
      paddingLeft: 'var(--space-4)',
      borderLeft: '1px solid var(--border-subtle)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: 'var(--status-online)'
    }
  }), host), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)'
    }
  }, right, /*#__PURE__*/React.createElement(IconButton, {
    label: "Toggle theme",
    onClick: onToggleTheme
  }, theme === 'dark' ? /*#__PURE__*/React.createElement(window.SunIcon, null) : /*#__PURE__*/React.createElement(window.MoonIcon, null))));
}
Object.assign(window, {
  BrandLogo,
  TopBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/agent-relay/Chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/agent-relay/LoginScreen.jsx
try { (() => {
// agent-relay · Login screen — authenticate to a relay host.
const {
  Button,
  Input
} = window.AgentRelayDesignSystem_9f29b7;
function LoginScreen({
  onConnect,
  theme,
  onToggleTheme
}) {
  const [host, setHost] = React.useState('main.local:7070');
  const [token, setToken] = React.useState('relay-demo-token');
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState('');
  const submit = e => {
    e.preventDefault();
    setError('');
    setConnecting(true);
    setTimeout(() => {
      if (token.trim().length < 4) {
        setConnecting(false);
        setError('Token rejected. Check it and try again.');
      } else {
        onConnect(host);
      }
    }, 850);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-app)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      opacity: 0.5,
      backgroundImage: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)',
      backgroundSize: '22px 22px',
      maskImage: 'radial-gradient(circle at 50% 38%, #000, transparent 60%)',
      WebkitMaskImage: 'radial-gradient(circle at 50% 38%, #000, transparent 60%)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'var(--space-5)',
      right: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onToggleTheme,
    "aria-label": "Toggle theme",
    style: {
      width: 36,
      height: 36,
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer',
      background: 'transparent',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-muted)'
    }
  }, theme === 'dark' ? /*#__PURE__*/React.createElement(window.SunIcon, null) : /*#__PURE__*/React.createElement(window.MoonIcon, null))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'grid',
      placeItems: 'center',
      padding: 'var(--space-6)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-4)',
      marginBottom: 'var(--space-8)'
    }
  }, /*#__PURE__*/React.createElement(window.BrandLogo, {
    size: 40,
    showWord: false
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-2xl)',
      marginBottom: 6
    }
  }, "Connect to your relay"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-muted)',
      fontSize: 'var(--text-base)'
    }
  }, "Reach the ", /*#__PURE__*/React.createElement("code", {
    style: {
      color: 'var(--text-accent)'
    }
  }, "node-pty"), " sessions running on your machine."))), /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-6)',
      boxShadow: 'var(--shadow-md)'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Relay host",
    mono: true,
    prefix: /*#__PURE__*/React.createElement(window.ServerIcon, {
      size: 16
    }),
    value: host,
    onChange: e => setHost(e.target.value),
    placeholder: "main.local:7070"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Access token",
    type: "password",
    mono: true,
    prefix: /*#__PURE__*/React.createElement(window.KeyIcon, {
      size: 16
    }),
    value: token,
    onChange: e => setToken(e.target.value),
    placeholder: "paste relay token",
    error: error,
    hint: error ? '' : 'Found in the relay daemon logs on first run.'
  }), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    fullWidth: true,
    loading: connecting,
    leadingIcon: connecting ? null : /*#__PURE__*/React.createElement(window.PlugIcon, {
      size: 16
    })
  }, connecting ? 'Connecting…' : 'Connect')), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      marginTop: 'var(--space-5)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-faint)'
    }
  }, "Relay not running? ", /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault()
  }, "Start the daemon")))));
}
window.LoginScreen = LoginScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/agent-relay/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/agent-relay/SessionsScreen.jsx
try { (() => {
// agent-relay · Sessions screen — pick a live session or start a new one.
const {
  Button,
  Card,
  Badge,
  StatusDot,
  IconButton,
  Input,
  Switch
} = window.AgentRelayDesignSystem_9f29b7;
const SHELLS = ['zsh', 'bash', 'fish'];
const PREVIEW_LINE = {
  cmd: t => /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-fg)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-accent)'
    }
  }, "\u203A"), " ", t),
  tool: t => /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-path)'
    }
  }, t),
  out: t => /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-fg)',
      opacity: 0.7
    }
  }, t),
  ok: t => /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--relay-500)'
    }
  }, t),
  live: t => /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-dim)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "rl-term-cursor"
  }), " ", t)
};
function TerminalPreview({
  lines = []
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--terminal-bg)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-subtle)',
      padding: '10px 12px',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xs)',
      lineHeight: 1.65,
      height: 92,
      overflow: 'hidden',
      position: 'relative'
    }
  }, lines.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, (PREVIEW_LINE[l.t] || PREVIEW_LINE.out)(l.text))));
}
function SessionCard({
  s,
  onAttach,
  onKill
}) {
  return /*#__PURE__*/React.createElement(Card, {
    interactive: true,
    padding: "md",
    onClick: () => onAttach(s),
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'var(--font-display)',
      fontWeight: 600,
      fontSize: 'var(--text-lg)',
      color: 'var(--text-strong)'
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: s.status,
    size: "sm",
    showLabel: false
  }), s.name), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, /*#__PURE__*/React.createElement(window.FolderIcon, {
    size: 13
  }), " ", s.cwd)), /*#__PURE__*/React.createElement(IconButton, {
    label: "Terminate",
    size: "sm",
    onClick: e => {
      e.stopPropagation();
      onKill(s.id);
    }
  }, /*#__PURE__*/React.createElement(window.TrashIcon, {
    size: 15
  }))), /*#__PURE__*/React.createElement(TerminalPreview, {
    lines: s.preview
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "accent"
  }, s.shell), /*#__PURE__*/React.createElement(Badge, {
    variant: "neutral"
  }, "pid ", s.pid), s.panes > 1 && /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, s.panes, " panes")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xs)',
      color: 'var(--text-faint)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(window.ClockIcon, {
    size: 12
  }), " ", s.lastActive)));
}
function NewSessionDialog({
  onClose,
  onCreate
}) {
  const [name, setName] = React.useState('');
  const [cwd, setCwd] = React.useState('~/');
  const [shell, setShell] = React.useState('zsh');
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 40,
      display: 'grid',
      placeItems: 'center',
      background: 'var(--surface-overlay)',
      backdropFilter: 'blur(2px)',
      padding: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: '100%',
      maxWidth: 420,
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-pop)',
      padding: 'var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 'var(--text-xl)'
    }
  }, "New session"), /*#__PURE__*/React.createElement(IconButton, {
    label: "Close",
    size: "sm",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(window.XIcon, {
    size: 16
  }))), /*#__PURE__*/React.createElement(Input, {
    label: "Session name",
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "api-dev",
    autoFocus: true
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Working directory",
    mono: true,
    value: cwd,
    onChange: e => setCwd(e.target.value),
    prefix: /*#__PURE__*/React.createElement(window.FolderIcon, {
      size: 15
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "relay-label"
  }, "Shell"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, SHELLS.map(sh => /*#__PURE__*/React.createElement("button", {
    key: sh,
    onClick: () => setShell(sh),
    style: {
      flex: 1,
      height: 36,
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid ' + (shell === sh ? 'var(--border-accent)' : 'var(--border-default)'),
      background: shell === sh ? 'var(--accent-soft)' : 'var(--surface-card)',
      color: shell === sh ? 'var(--text-accent)' : 'var(--text-body)'
    }
  }, sh)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      marginTop: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    fullWidth: true,
    leadingIcon: /*#__PURE__*/React.createElement(window.TerminalIcon, {
      size: 16
    }),
    onClick: () => onCreate({
      name: name.trim() || 'untitled',
      cwd,
      shell
    })
  }, "Create & attach"))));
}
function SessionsScreen({
  host,
  sessions,
  onAttach,
  onKill,
  onCreate,
  theme,
  onToggleTheme
}) {
  const [query, setQuery] = React.useState('');
  const [dialog, setDialog] = React.useState(false);
  const filtered = sessions.filter(s => (s.name + ' ' + s.cwd).toLowerCase().includes(query.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-app)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(window.TopBar, {
    host: host,
    theme: theme,
    onToggleTheme: onToggleTheme,
    right: /*#__PURE__*/React.createElement(IconButton, {
      label: "Settings"
    }, /*#__PURE__*/React.createElement(window.SettingsIcon, null))
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      width: '100%',
      maxWidth: 'var(--container-w)',
      margin: '0 auto',
      padding: 'var(--space-8) var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      flexWrap: 'wrap',
      marginBottom: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "relay-label"
  }, "Active sessions"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-3xl)',
      marginTop: 6
    }
  }, sessions.length, " session", sessions.length === 1 ? '' : 's', " on ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-accent)'
    }
  }, "main"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 220
    }
  }, /*#__PURE__*/React.createElement(Input, {
    prefix: /*#__PURE__*/React.createElement(window.SearchIcon, {
      size: 15
    }),
    placeholder: "Filter sessions",
    value: query,
    onChange: e => setQuery(e.target.value)
  })), /*#__PURE__*/React.createElement(Button, {
    leadingIcon: /*#__PURE__*/React.createElement(window.PlusIcon, {
      size: 16
    }),
    onClick: () => setDialog(true)
  }, "New session"))), filtered.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: 'var(--space-20) 0',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)'
    }
  }, "No sessions match \u201C", query, "\u201D.")) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 'var(--space-4)'
    }
  }, filtered.map(s => /*#__PURE__*/React.createElement(SessionCard, {
    key: s.id,
    s: s,
    onAttach: onAttach,
    onKill: onKill
  })))), dialog && /*#__PURE__*/React.createElement(NewSessionDialog, {
    onClose: () => setDialog(false),
    onCreate: d => {
      setDialog(false);
      onCreate(d);
    }
  }));
}
window.SessionsScreen = SessionsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/agent-relay/SessionsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/agent-relay/TerminalScreen.jsx
try { (() => {
// agent-relay · Terminal screen — interactive agent session attached to a pty.
// Renders an agent transcript: tool calls, file results, inline diffs, prose,
// a working indicator, and an input box. Original agent-relay styling.
const {
  Badge,
  StatusDot,
  IconButton,
  Kbd
} = window.AgentRelayDesignSystem_9f29b7;

// ---- transcript line renderers -------------------------------------------

function Dot({
  color = 'var(--relay-500)'
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
      marginTop: 7
    }
  });
}
function ToolLine({
  name,
  arg,
  result,
  hint
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 9,
      margin: '14px 0 2px'
    }
  }, /*#__PURE__*/React.createElement(Dot, null), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-fg)',
      fontWeight: 700
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-dim)'
    }
  }, "(", arg, ")")), result && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--terminal-dim)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.6
    }
  }, "\u2514 "), result, hint && /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.5
    }
  }, " (", hint, ")"))));
}
function SayLine({
  text
}) {
  // text may contain {path}…{/path} markers for accent-colored paths
  const parts = String(text).split(/(\{path\}.*?\{\/path\})/g).filter(Boolean);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 9,
      margin: '14px 0'
    }
  }, /*#__PURE__*/React.createElement(Dot, {
    color: "var(--terminal-dim)"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--terminal-fg)',
      opacity: 0.92,
      lineHeight: 1.7,
      margin: 0
    }
  }, parts.map((p, i) => p.startsWith('{path}') ? /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      color: 'var(--terminal-path)'
    }
  }, p.slice(6, -7)) : /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, p))));
}
function UserLine({
  text
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 9,
      margin: '14px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-accent)',
      fontWeight: 700,
      marginTop: 0
    }
  }, "\u203A"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--terminal-fg)',
      margin: 0
    }
  }, text));
}
function DiffBlock({
  file,
  rows
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingLeft: 16,
      margin: '4px 0 2px'
    }
  }, rows.map((r, i) => {
    const bg = r.type === 'add' ? 'var(--diff-add-bg)' : r.type === 'del' ? 'var(--diff-del-bg)' : 'transparent';
    const fg = r.type === 'add' ? 'var(--diff-add-fg)' : r.type === 'del' ? 'var(--diff-del-fg)' : 'var(--terminal-fg)';
    const sign = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        background: bg
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 26,
        textAlign: 'right',
        color: 'var(--terminal-dim)',
        opacity: 0.7,
        flexShrink: 0,
        paddingRight: 8
      }
    }, r.n), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        color: fg,
        flexShrink: 0,
        opacity: r.type === 'ctx' ? 0.4 : 1
      }
    }, sign), /*#__PURE__*/React.createElement("span", {
      style: {
        color: fg,
        whiteSpace: 'pre',
        opacity: r.type === 'ctx' ? 0.8 : 1
      }
    }, r.text));
  }));
}
function WorkingLine({
  text
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      margin: '14px 0 4px',
      color: 'var(--terminal-accent)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "rl-term-cursor",
    style: {
      marginTop: 0
    }
  }), /*#__PURE__*/React.createElement("span", null, text));
}
function TranscriptLine({
  l
}) {
  switch (l.type) {
    case 'tool':
      return /*#__PURE__*/React.createElement(ToolLine, l);
    case 'say':
      return /*#__PURE__*/React.createElement(SayLine, {
        text: l.text
      });
    case 'user':
      return /*#__PURE__*/React.createElement(UserLine, {
        text: l.text
      });
    case 'diff':
      return /*#__PURE__*/React.createElement(DiffBlock, {
        file: l.file,
        rows: l.rows
      });
    case 'working':
      return /*#__PURE__*/React.createElement(WorkingLine, {
        text: l.text
      });
    case 'sys':
      return /*#__PURE__*/React.createElement("div", {
        style: {
          color: 'var(--terminal-accent)',
          opacity: 0.8,
          marginBottom: 4
        }
      }, "\u2014 ", l.text);
    default:
      return /*#__PURE__*/React.createElement("div", {
        style: {
          color: 'var(--terminal-fg)',
          opacity: 0.8
        }
      }, l.text);
  }
}

// ---- canned starting transcript ------------------------------------------

function startTranscript(session) {
  return [{
    type: 'sys',
    text: `Attached to session "${session.name}" · ${session.shell} · pid ${session.pid}`
  }, {
    type: 'user',
    text: 'expand the test coverage for the search ranking module'
  }, {
    type: 'say',
    text: "I'll look at what's there first, then fill the gaps."
  }, {
    type: 'tool',
    name: 'List',
    arg: 'src/search',
    result: 'Listed 12 files',
    hint: 'ctrl+r to expand'
  }, {
    type: 'tool',
    name: 'Read',
    arg: 'src/search/rank.js',
    result: 'Read 84 lines',
    hint: 'ctrl+r to expand'
  }, {
    type: 'say',
    text: 'There are a few ranking tests, but empty-query and tie-break edge cases aren\u2019t covered. I\u2019ll add them in {path}test/rank.test.js{/path}.'
  }, {
    type: 'tool',
    name: 'Update',
    arg: 'test/rank.test.js',
    result: 'Updated with 2 additions and 1 removal'
  }, {
    type: 'diff',
    file: 'test/rank.test.js',
    rows: [{
      n: 1,
      type: 'ctx',
      text: "import { rank } from '../src/search/rank.js'"
    }, {
      n: 2,
      type: 'del',
      text: "test('ranks results', () => {"
    }, {
      n: 2,
      type: 'add',
      text: "test('ranks results by score, stable on ties', () => {"
    }, {
      n: 3,
      type: 'add',
      text: "  expect(rank('', docs)).toEqual([])"
    }, {
      n: 4,
      type: 'ctx',
      text: '  expect(rank(q, docs)).toBeSorted()'
    }]
  }, {
    type: 'working',
    text: 'running tests\u2026 27s · esc to cancel'
  }];
}
const REPLY = "On it \u2014 running that against the current branch now.";
function TerminalScreen({
  session,
  host,
  onBack,
  theme,
  onToggleTheme
}) {
  const [lines, setLines] = React.useState(() => startTranscript(session));
  const [input, setInput] = React.useState('');
  const viewRef = React.useRef(null);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight;
  }, [lines]);
  const send = () => {
    const t = input.trim();
    if (!t) return;
    if (t === 'clear') {
      setLines([]);
      setInput('');
      return;
    }
    setLines(prev => [...prev.filter(l => l.type !== 'working'), {
      type: 'user',
      text: t
    }]);
    setInput('');
    setTimeout(() => setLines(prev => [...prev, {
      type: 'say',
      text: REPLY
    }]), 450);
  };
  const onKey = e => {
    if (e.key === 'Enter') send();
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-app)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      height: 52,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: '0 var(--space-4)',
      background: 'var(--surface-card)',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    label: "Back to sessions",
    onClick: onBack
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m15 18-6-6 6-6"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(window.TerminalIcon, {
    size: 16
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, session.name), /*#__PURE__*/React.createElement(Badge, {
    variant: "accent"
  }, session.shell), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-faint)',
      whiteSpace: 'nowrap'
    }
  }, session.cwd)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: "online",
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      height: 22,
      background: 'var(--border-subtle)',
      margin: '0 4px'
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    label: "Copy buffer"
  }, /*#__PURE__*/React.createElement(window.CopyIcon, {
    size: 16
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Split pane"
  }, /*#__PURE__*/React.createElement(window.SplitIcon, {
    size: 16
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Fullscreen"
  }, /*#__PURE__*/React.createElement(window.MaximizeIcon, {
    size: 16
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Toggle theme",
    onClick: onToggleTheme
  }, theme === 'dark' ? /*#__PURE__*/React.createElement(window.SunIcon, {
    size: 16
  }) : /*#__PURE__*/React.createElement(window.MoonIcon, {
    size: 16
  })))), /*#__PURE__*/React.createElement("div", {
    ref: viewRef,
    onClick: () => inputRef.current && inputRef.current.focus(),
    style: {
      flex: 1,
      overflowY: 'auto',
      background: 'var(--terminal-bg)',
      color: 'var(--terminal-fg)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      lineHeight: 1.6,
      padding: 'var(--space-5) var(--space-6)',
      cursor: 'text'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 880
    }
  }, lines.map((l, i) => /*#__PURE__*/React.createElement(TranscriptLine, {
    key: i,
    l: l
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      background: 'var(--terminal-bg)',
      borderTop: '1px solid var(--terminal-border)',
      padding: 'var(--space-4) var(--space-6) var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 880
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      border: '1px solid var(--terminal-border)',
      borderRadius: 'var(--radius-lg)',
      padding: '11px 14px',
      background: 'var(--surface-card)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--terminal-accent)',
      fontWeight: 700,
      fontFamily: 'var(--font-mono)'
    }
  }, "\u203A"), /*#__PURE__*/React.createElement("input", {
    ref: inputRef,
    value: input,
    onChange: e => setInput(e.target.value),
    onKeyDown: onKey,
    autoFocus: true,
    spellCheck: false,
    placeholder: "Ask the session to do something\u2026",
    style: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: 'var(--text-strong)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      caretColor: 'var(--terminal-accent)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      marginTop: 8,
      paddingLeft: 4,
      color: 'var(--terminal-dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xs)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "enter to send"), /*#__PURE__*/React.createElement("span", null, "\u2318K commands"), /*#__PURE__*/React.createElement("span", null, "esc to cancel a run")))), /*#__PURE__*/React.createElement("footer", {
    style: {
      height: 30,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: '0 var(--space-5)',
      background: 'var(--surface-card)',
      borderTop: '1px solid var(--border-subtle)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xs)',
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-accent)'
    }
  }, "\u25CF ", host), /*#__PURE__*/React.createElement("span", null, "utf-8"), /*#__PURE__*/React.createElement("span", null, session.shell), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      display: 'inline-flex',
      gap: 8,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Kbd, {
    keys: ['Ctrl', 'D']
  }), " detach")));
}
window.TerminalScreen = TerminalScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/agent-relay/TerminalScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/agent-relay/icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Lucide-style inline stroke icons for the agent-relay UI kit.
// 24x24, 2px stroke, round caps. Exported to window for cross-script use.
const Icon = ({
  size = 18,
  children,
  ...rest
}) => /*#__PURE__*/React.createElement("svg", _extends({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, rest), children);
const PlusIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M12 5v14"
}), /*#__PURE__*/React.createElement("path", {
  d: "M5 12h14"
}));
const ServerIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "4",
  width: "18",
  height: "7",
  rx: "1.5"
}), /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "13",
  width: "18",
  height: "7",
  rx: "1.5"
}), /*#__PURE__*/React.createElement("path", {
  d: "M7 7.5h.01M7 16.5h.01"
}));
const KeyIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "7.5",
  cy: "15.5",
  r: "3.5"
}), /*#__PURE__*/React.createElement("path", {
  d: "M10 13 20 3"
}), /*#__PURE__*/React.createElement("path", {
  d: "m17 6 2 2"
}), /*#__PURE__*/React.createElement("path", {
  d: "m14 9 2 2"
}));
const TerminalIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "m7 9 3 3-3 3"
}), /*#__PURE__*/React.createElement("path", {
  d: "M13 15h4"
}), /*#__PURE__*/React.createElement("rect", {
  x: "2",
  y: "4",
  width: "20",
  height: "16",
  rx: "2"
}));
const SearchIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "11",
  cy: "11",
  r: "7"
}), /*#__PURE__*/React.createElement("path", {
  d: "m21 21-4.3-4.3"
}));
const SettingsIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "3"
}), /*#__PURE__*/React.createElement("path", {
  d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 9.4l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11.6 4.6h-.1a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9z"
}));
const SunIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
}));
const MoonIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
}));
const PlugIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M12 22v-5"
}), /*#__PURE__*/React.createElement("path", {
  d: "M9 7V2M15 7V2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M5 7h14v3a7 7 0 0 1-7 7 7 7 0 0 1-7-7Z"
}));
const XIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M18 6 6 18M6 6l12 12"
}));
const FolderIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"
}));
const ClockIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "9"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 7v5l3 2"
}));
const SplitIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "3",
  width: "18",
  height: "18",
  rx: "2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 3v18"
}));
const TrashIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
}));
const ChevronRight = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "m9 6 6 6-6 6"
}));
const CopyIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
  x: "9",
  y: "9",
  width: "12",
  height: "12",
  rx: "2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
}));
const MaximizeIcon = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"
}));
Object.assign(window, {
  PlusIcon,
  ServerIcon,
  KeyIcon,
  TerminalIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
  PlugIcon,
  XIcon,
  FolderIcon,
  ClockIcon,
  SplitIcon,
  TrashIcon,
  ChevronRight,
  CopyIcon,
  MaximizeIcon
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/agent-relay/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Kbd = __ds_scope.Kbd;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.Switch = __ds_scope.Switch;

})();

// Lucide-style inline stroke icons for the agent-relay UI kit.
// 24x24, 2px stroke, round caps. Exported to window for cross-script use.
const Icon = ({ size = 18, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>{children}</svg>
);

const PlusIcon    = (p) => <Icon {...p}><path d="M12 5v14"/><path d="M5 12h14"/></Icon>;
const ServerIcon  = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></Icon>;
const KeyIcon     = (p) => <Icon {...p}><circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13 20 3"/><path d="m17 6 2 2"/><path d="m14 9 2 2"/></Icon>;
const TerminalIcon= (p) => <Icon {...p}><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/><rect x="2" y="4" width="20" height="16" rx="2"/></Icon>;
const SearchIcon  = (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></Icon>;
const SettingsIcon= (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 9.4l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11.6 4.6h-.1a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9z"/></Icon>;
const SunIcon     = (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></Icon>;
const MoonIcon    = (p) => <Icon {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></Icon>;
const PlugIcon    = (p) => <Icon {...p}><path d="M12 22v-5"/><path d="M9 7V2M15 7V2"/><path d="M5 7h14v3a7 7 0 0 1-7 7 7 7 0 0 1-7-7Z"/></Icon>;
const XIcon       = (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12"/></Icon>;
const FolderIcon  = (p) => <Icon {...p}><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/></Icon>;
const ClockIcon   = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>;
const SplitIcon   = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></Icon>;
const TrashIcon   = (p) => <Icon {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></Icon>;
const ChevronRight= (p) => <Icon {...p}><path d="m9 6 6 6-6 6"/></Icon>;
const CopyIcon    = (p) => <Icon {...p}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Icon>;
const MaximizeIcon= (p) => <Icon {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></Icon>;

Object.assign(window, {
  PlusIcon, ServerIcon, KeyIcon, TerminalIcon, SearchIcon, SettingsIcon,
  SunIcon, MoonIcon, PlugIcon, XIcon, FolderIcon, ClockIcon, SplitIcon,
  TrashIcon, ChevronRight, CopyIcon, MaximizeIcon,
});

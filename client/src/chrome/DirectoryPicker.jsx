import React from 'react';
import { Button } from '@ds/Button.jsx';
import { Input } from '@ds/Input.jsx';
import { Folder, CornerLeftUp, Search } from 'lucide-react';
import { browseDir, BrowseError } from '../core/api.ts';
import { joinChildPath } from '../core/pickerPath.ts';
import styles from './DirectoryPicker.module.scss';

// Touch-first directory picker for the create dialog's Working Directory field.
// Swaps into the dialog body (no stacked modal) and lists the BOARD's filesystem
// via GET /api/fs/browse — the browsable disk is the server's, not the phone's.
// The current folder IS the selection: descend into the folder you want, then
// "Use this folder". A typed-in nonexistent seed falls back to home rather than
// stranding an empty picker.
const ERROR_TEXT = {
  denied: 'Permission denied',
  'not-found': 'Folder not found',
  'not-a-directory': 'Not a folder',
};

export function DirectoryPicker({ initialPath, onPick, onCancel }) {
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');
  // Client-side substring filter over the loaded entries — no extra round-trip.
  // Cleared on every navigation (a new folder is a fresh list).
  const [filter, setFilter] = React.useState('');
  // Monotonic request id: a fast tap-through must not let a slow earlier listing
  // land after a later one and show the wrong folder.
  const reqRef = React.useRef(0);

  const navigate = React.useCallback(async (target, { fallbackHome = false } = {}) => {
    const seq = ++reqRef.current;
    setLoading(true);
    setErrorMsg('');
    setFilter('');
    try {
      const res = await browseDir(target);
      if (seq !== reqRef.current) return;
      setResult(res);
    } catch (e) {
      if (seq !== reqRef.current) return;
      // A bad typed seed on first open drops to home instead of a dead end;
      // a bad navigation later keeps the current list and just shows why.
      if (fallbackHome) { navigate('~'); return; }
      setErrorMsg(
        e instanceof BrowseError ? (ERROR_TEXT[e.code] ?? 'Cannot open folder') : 'Cannot reach the server'
      );
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    navigate((initialPath ?? '').trim() || '~', { fallbackHome: true });
  }, [initialPath, navigate]);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? (result?.entries ?? []).filter((e) => e.name.toLowerCase().includes(q))
    : (result?.entries ?? []);

  return (
    <div className={styles.picker}>
      <div className={styles.pathBar} title={result?.path}>
        {result?.path ?? '…'}
      </div>

      {result && result.entries.length > 0 && (
        <Input
          size="sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter folders"
          prefix={<Search size={14} />}
        />
      )}

      {errorMsg && <p className={styles.error}>{errorMsg}</p>}

      <div className={styles.list} aria-busy={loading}>
        {!result && loading && <div className={styles.empty}>Loading…</div>}
        {result?.parent && (
          <button type="button" className={styles.row} onClick={() => navigate(result.parent)}>
            <CornerLeftUp size={16} className={styles.rowIcon} />
            <span className={styles.rowName}>..</span>
          </button>
        )}
        {visible.map((e) => (
          <button
            type="button"
            key={e.name}
            className={styles.row}
            onClick={() => navigate(joinChildPath(result.path, e.name))}
          >
            <Folder size={16} className={styles.rowIcon} />
            <span className={styles.rowName}>{e.name}</span>
          </button>
        ))}
        {result && result.entries.length === 0 && (
          <div className={styles.empty}>No subfolders here</div>
        )}
        {result && result.entries.length > 0 && visible.length === 0 && (
          <div className={styles.empty}>No folders match “{filter.trim()}”</div>
        )}
      </div>

      {result?.truncated && (
        <div className={styles.truncated}>
          Showing the first {result.entries.length} folders — narrow by typing the path.
        </div>
      )}

      <div className={styles.footer}>
        <Button variant="ghost" onClick={onCancel}>Back</Button>
        <Button fullWidth disabled={!result?.path} onClick={() => onPick(result.path)}>
          Use this folder
        </Button>
      </div>
    </div>
  );
}

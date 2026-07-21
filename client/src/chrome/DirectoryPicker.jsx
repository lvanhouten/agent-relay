import React from 'react';
import { Button } from '@shared/Button.jsx';
import { Input } from '@shared/Input.jsx';
import { IconButton } from '@shared/IconButton.jsx';
import { Folder, CornerLeftUp, Search, Star, X } from 'lucide-react';
import { browseDir, BrowseError } from '../core/api.ts';
import { joinChildPath } from '../core/pickerPath.ts';
import {
  loadFavorites, saveFavorites, addFavorite, removeFavorite, isFavorite,
} from '../core/favorites.ts';
import styles from './DirectoryPicker.module.scss';

// Browses the BOARD's filesystem (not the phone's) via GET /api/fs/browse.
// The current folder IS the selection; a bad typed seed falls back to home.
const ERROR_TEXT = {
  denied: 'Permission denied',
  'not-found': 'Folder not found',
  'not-a-directory': 'Not a folder',
};

export function DirectoryPicker({ initialPath, onPick, onCancel }) {
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');
  // Client-side substring filter; cleared on every navigation.
  const [filter, setFilter] = React.useState('');
  const [favorites, setFavorites] = React.useState(loadFavorites);
  // Monotonic request id: blocks a slow earlier listing from landing after a later one.
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
      // Only a first-open seed falls back home; a later bad navigation keeps the list.
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

  const persistFavorites = (next) => { setFavorites(next); saveFavorites(next); };

  const pinned = result?.path ? isFavorite(favorites, result.path) : false;
  const togglePin = () => {
    if (!result?.path) return;
    persistFavorites(
      pinned ? removeFavorite(favorites, result.path) : addFavorite(favorites, result.path)
    );
  };

  const q = filter.trim().toLowerCase();
  const visible = q
    ? (result?.entries ?? []).filter((e) => e.name.toLowerCase().includes(q))
    : (result?.entries ?? []);

  return (
    <div className={styles.picker}>
      <div className={styles.pathRow}>
        <div className={styles.pathBar} title={result?.path}>
          {result?.path ?? '…'}
        </div>
        <IconButton
          size="sm"
          bordered
          active={pinned}
          disabled={!result?.path}
          label={pinned ? 'Unpin this folder' : 'Pin this folder'}
          onClick={togglePin}
        >
          <Star size={15} fill={pinned ? 'currentColor' : 'none'} />
        </IconButton>
      </div>

      {favorites.length > 0 && (
        <div className={styles.favRow}>
          {favorites.map((path) => (
            <span key={path} className={styles.favChip}>
              <button
                type="button"
                className={styles.favChipButton}
                title={path}
                onClick={() => navigate(path)}
              >
                <Star size={12} fill="currentColor" />
                <span className={styles.favChipName}>{leaf(path)}</span>
              </button>
              <button
                type="button"
                className={styles.favChipDelete}
                aria-label={`Unpin ${path}`}
                title="Unpin"
                onClick={() => persistFavorites(removeFavorite(favorites, path))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

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

// Chip label: the folder's own name, not the full path (which lives in the title).
function leaf(path) {
  const segs = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return segs[segs.length - 1] || path;
}

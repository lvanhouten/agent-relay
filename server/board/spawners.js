'use strict';
// Detect the terminal a command was invoked from and return a recipe for
// opening a new pane/window that runs an arbitrary command.
//
// Detection MUST run client-side (in sb): the board is a detached daemon and
// has no view of the caller's terminal. sb sends the recipe to the board, which
// substitutes the command ([node, patch.js, <id>]) for the '{cmd}' token and
// spawns it, merging recipe.env so it can reach the caller's mux socket/session.
//
//   recipe = { kind, file, args, env } | null   (null = couldn't tell)

const pick = (env, keys) =>
  Object.fromEntries(keys.filter(k => env[k] != null).map(k => [k, env[k]]));

function detectSpawner(env = process.env) {
  // Multiplexers first — these put the new pane in the caller's CURRENT window.
  if (env.WEZTERM_PANE != null)
    return { kind: 'wezterm', file: 'wezterm', args: ['cli', 'spawn', '--', '{cmd}'],
             env: pick(env, ['WEZTERM_UNIX_SOCKET']) };

  if (env.TMUX)
    return { kind: 'tmux', file: 'tmux',
             args: ['split-window', '-t', env.TMUX_PANE || '', '{cmd}'],
             env: pick(env, ['TMUX']) };

  if (env.KITTY_LISTEN_ON)  // needs `allow_remote_control yes` + a listen socket
    return { kind: 'kitty', file: 'kitty', args: ['@', 'launch', '--type=window', '{cmd}'],
             env: pick(env, ['KITTY_LISTEN_ON']) };

  if (env.WT_SESSION)  // Windows Terminal — `-w 0` targets the current window
    return { kind: 'wt', file: 'wt', args: ['-w', '0', 'split-pane', '{cmd}'], env: {} };

  // Explicit override / unknown terminals. Template must contain a {cmd} token,
  // e.g. SWITCHBOARD_TERM="alacritty -e {cmd}"  /  "gnome-terminal -- {cmd}".
  if (env.SWITCHBOARD_TERM) {
    const parts = env.SWITCHBOARD_TERM.split(/\s+/).filter(Boolean);
    return { kind: 'custom', file: parts[0], args: parts.slice(1), env: {} };
  }

  // Last-resort platform default; Windows Terminal ships on Win11.
  if (process.platform === 'win32')
    return { kind: 'wt-default', file: 'wt', args: ['-w', '0', 'split-pane', '{cmd}'], env: {} };

  return null;  // caller should warn the user to set SWITCHBOARD_TERM
}

module.exports = { detectSpawner };

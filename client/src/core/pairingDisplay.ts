// Pure status -> display mapping for the pair-device dialog.
// Kept in core so the state fan-out (up/down/disabled/unknown) is unit-tested
// instead of only visible as JSX branches — the dialog itself just renders
// whatever this returns, plus the QR image when showQr is true.
import type { PairingInfo } from './types.ts';

export interface PairingDisplay {
  heading: string;
  // Present only when there's no QR to show — the down/disabled explanation.
  // Null when showQr is true (the URL text under the QR carries the detail).
  message: string | null;
  showQr: boolean;
}

// AR_TUNNEL is the one env var that flips 'disabled' -> 'down'/'up' (see
// server/src/tunnel.js); the disabled state's reason is always null server-side
// (nothing failed — tunneling was never asked for), so the fix instruction lives
// here rather than expecting the endpoint to supply one.
const DISABLED_MESSAGE =
  'Tunneling is off. Set AR_TUNNEL=tailscale (and restart the server) to pair a device from outside this machine.';

export function pairingDisplay(info: PairingInfo): PairingDisplay {
  switch (info.tunnel.state) {
    case 'up':
      return { heading: 'Scan to pair a device', message: null, showQr: true };
    case 'down':
      return {
        heading: 'Tunnel is down',
        message: info.tunnel.reason ?? 'The tunnel is not currently reachable.',
        showQr: false,
      };
    case 'disabled':
      return { heading: 'Tunneling is disabled', message: DISABLED_MESSAGE, showQr: false };
    default:
      // An older/newer server could in principle send an unrecognized state
      // string; render it rather than throwing (types.ts keeps Session.status
      // as a plain string for the same forward-compat reason).
      return {
        heading: `Unknown tunnel state: ${info.tunnel.state}`,
        message: info.tunnel.reason,
        showQr: false,
      };
  }
}

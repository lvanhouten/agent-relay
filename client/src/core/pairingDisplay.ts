// Pure status -> display mapping for the pair-device dialog; the dialog just
// renders whatever this returns, plus the QR image when showQr is true.
import type { PairingInfo } from './types.ts';

export interface PairingDisplay {
  heading: string;
  // Present only when there's no QR to show — the down/disabled explanation.
  // Null when showQr is true (the URL text under the QR carries the detail).
  message: string | null;
  showQr: boolean;
}

// AR_TUNNEL flips 'disabled' -> 'down'/'up'; the disabled state's server-side
// reason is always null (nothing failed, tunneling was never requested), so
// the fix instruction lives here instead.
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
      // An unrecognized state string is rendered, not thrown — same
      // forward-compat reason types.ts keeps Session.status a plain string.
      return {
        heading: `Unknown tunnel state: ${info.tunnel.state}`,
        message: info.tunnel.reason,
        showQr: false,
      };
  }
}

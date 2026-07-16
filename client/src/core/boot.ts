// Pure decision logic for the client boot flow: which screen to land on at
// first paint, given a possible
// QR-pairing fragment token and/or an ambient auth cookie. Kept side-effect
// free — network calls (login exchange, ambient-cookie probe) are injected
// via BootDeps — so the branching is unit-testable without a real fetch or
// window. See App.jsx for the wiring: reading/stripping the fragment
// (fragmentPairing.ts) happens there, BEFORE this is called, so the token
// never lingers in the address bar regardless of the outcome.
//
// Contract: BootDeps functions must resolve to a boolean, never throw/reject
// — a network failure is "not authenticated", not an exception the decision
// logic has to know about. Callers (App.jsx) wrap the real login()/probe
// calls accordingly.

export type BootOutcome =
  | { screen: 'sessions' }
  | { screen: 'login'; error?: string };

export interface BootDeps {
  // Exchanges a fragment token at the login endpoint. Resolves to whether a
  // cookie was granted (POST /api/login: 204 -> true, 401 -> false).
  login: (token: string) => Promise<boolean>;
  // Ambient-cookie probe: a credentialed request carrying no bearer.
  // Resolves true if it authenticates (cookie present and valid).
  probe: () => Promise<boolean>;
}

export const STALE_PAIRING_ERROR =
  'This pairing link is stale — it was already used or has been rotated. Sign in with your access token.';

export async function decideBoot(
  fragmentToken: string | null,
  deps: BootDeps,
): Promise<BootOutcome> {
  if (fragmentToken) {
    const granted = await deps.login(fragmentToken);
    return granted ? { screen: 'sessions' } : { screen: 'login', error: STALE_PAIRING_ERROR };
  }
  const authenticated = await deps.probe();
  return authenticated ? { screen: 'sessions' } : { screen: 'login' };
}

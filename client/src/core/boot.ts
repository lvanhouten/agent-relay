// Pure decision logic for which screen to land on at boot, given a possible
// QR-pairing fragment token and/or an ambient auth cookie. Network calls are
// injected via BootDeps so the branching is unit-testable with no real fetch.
// App.jsx strips the fragment (fragmentPairing.ts) BEFORE calling this, so the
// token never lingers in the address bar regardless of outcome.
//
// Contract: BootDeps functions must resolve to a boolean, never throw/reject —
// a network failure just means "not authenticated".

export type BootOutcome =
  | { screen: 'sessions' }
  | { screen: 'login'; error?: string };

export interface BootDeps {
  // Exchanges a fragment token at the login endpoint (POST /api/login: 204 ->
  // true, 401 -> false).
  login: (token: string) => Promise<boolean>;
  // Ambient-cookie probe: a credentialed request with no bearer; true iff a
  // valid cookie is already present.
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

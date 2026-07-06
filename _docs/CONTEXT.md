# Domain Context

Glossary of canonical terms for agent-relay. Terms here are settled — use them
exactly; don't introduce synonyms.

## Glossary

### Session
A PTY session — a live shell owned by the board (a "line"), listed on the
sessions screen and attachable from a terminal view. **Never** refers to
browser authentication state; the auth-side artifact is the *auth cookie*.

### Access token
The relay's root credential: the bearer secret that gates the REST API and, for
non-browser clients, the WS attach. Printed at startup when generated. Proving
possession of it is how a device pairs.

### Auth cookie
The browser-side credential issued after a successful token login: an HttpOnly,
HMAC-signed cookie verified statelessly by the server. Deliberately not called
a "session cookie" — *session* is taken (see Session). Revoked wholesale by
rotating the access token / signing secret.

### Pairing
The flow that takes a device from unauthenticated to holding an auth cookie:
scan the pairing QR (or type the token), pass the login probe, receive the
cookie. A *paired* device stays authenticated across server restarts and page
reloads.

### Pairing QR
A QR code encoding the relay's public URL with the access token in the URL
fragment — a one-time bootstrap: the client reads the fragment, exchanges it
for an auth cookie, and strips it from the URL. Fragments are used because they
never reach server logs or Referer headers.

### Tunnel
The reverse-proxy path that makes the relay reachable from another device —
v1: `tailscale serve`, exposing the relay at the machine's stable tailnet URL.
Reachability is tailnet-scoped; the tunnel is not the auth boundary (the token
and origin gates still apply).

### Same-origin model
The client's reachability rule: you reach a relay by loading the page *from*
it (directly or through a tunnel) — page, API, and WS stream all target the
page's own origin. There is no typed "relay host".

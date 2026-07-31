# TURN credentials

Mints short-lived TURN credentials so the secret never reaches the browser.

Without TURN, calls connect over STUN alone. That works on most home and mobile
networks and fails behind symmetric NAT or a corporate firewall - roughly 10-20%
of real-world networks. TURN relays the media for those cases.

**Until this function is deployed and configured, PINGO runs STUN-only and calls
still work for most people.** Nothing breaks; some calls just fail to connect.

## Why the credential is not in `.env`

Anything Vite exposes to the browser (`VITE_*`) is readable from devtools. A
long-lived TURN credential there is an open relay - anyone can lift it and push
their own traffic through your server, on your bill. Hence: secret server-side,
expiring credential to the client.

## Status

Deployed and reachable from the app. It currently returns `{"iceServers": []}`
because no provider secrets are set - so calls run STUN-only until Option A
below is finished.

## Deploy

```bash
pnpm functions:deploy
```

### "Verify JWT with legacy secret" must stay OFF

Dashboard → Edge Functions → `turn-credentials` → Settings. It is already off.

Leaving it on breaks the CORS preflight and every browser call fails with an
opaque `TypeError: Failed to fetch`. It is also not the protection it sounds
like: that gateway check is satisfied by the **anon key**, which ships in the
bundle and every visitor has. The real check is `verifyUser()` inside the
function, which asks the Auth API whether the token belongs to a signed-in user
 -  verified: anon key gets `401 Sign in required`, a real session gets through.

Then set the secrets for **one** of the two backends below. The client cannot
tell them apart.

## Option A - Cloudflare Realtime TURN

Managed, nothing to run. Free for the first 1,000 GB of egress per month, then
$0.05/GB, shared with Cloudflare's SFU. See
[pricing](https://developers.cloudflare.com/realtime/sfu/pricing).

1. Cloudflare dashboard → **Realtime** → **TURN Keys** → create a key.
2. Copy the key id and its API token.
3. Set the secrets - **run this yourself, so the token stays with you**:

```bash
pnpm supabase secrets set \
  TURN_PROVIDER=cloudflare \
  CF_TURN_KEY_ID=<your key id> \
  CF_TURN_API_TOKEN=<your api token> \
  --project-ref lppzoqgvshhmxqsvggug
```

Or paste them in the dashboard: Edge Functions → **Secrets**.

## Option B - self-hosted coturn

Cheaper at volume, and yours. Needs a VPS with a public IP and open ports.

`/etc/turnserver.conf`:

```conf
listening-port=3478
tls-listening-port=5349

# The REST API scheme. `static-auth-secret` is the same string the Edge
# Function signs with - that shared secret is the whole authentication scheme,
# so it must never appear anywhere a browser can read.
use-auth-secret
static-auth-secret=<a long random string>

realm=turn.yourdomain.com
# The server's public IP. Behind a cloud NAT, coturn cannot discover this
# itself and will hand out unreachable candidates without it.
external-ip=<public ip>

# TLS, so TURN works on networks that only allow 443.
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem

# Relay only; no reason to let strangers proxy arbitrary traffic.
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
```

Open UDP+TCP 3478, TCP 5349, and the relay range (default UDP 49152-65535).

```bash
supabase secrets set \
  TURN_PROVIDER=coturn \
  TURN_URLS="turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp,turns:turn.yourdomain.com:5349?transport=tcp" \
  TURN_STATIC_AUTH_SECRET=<the same secret as above> \
  --project-ref lppzoqgvshhmxqsvggug
```

## Verify

With the app open and signed in, in the browser console:

```js
const { getSupabaseClient } = await import('/src/lib/supabase/client.ts');
const { data } = await getSupabaseClient().functions.invoke('turn-credentials');
data.iceServers;   // should contain a turn: or turns: URL with a username
```

To prove a call actually *relays* rather than just having the option to, start a
call and check the selected candidate pair:

```js
// `relay` on either end means TURN carried it.
[...(await pc.getStats())].filter(([, s]) => s.type === 'candidate-pair' && s.state === 'succeeded');
```

`resolveIceServers()` caches for the credential's lifetime, and caches a
STUN-only result for 5 minutes on failure - so after deploying, a call placed
within the next few minutes may still be STUN-only. Reload to clear it.

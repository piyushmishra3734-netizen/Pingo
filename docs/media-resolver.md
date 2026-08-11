# Turning a link into the video

PINGO can play a YouTube or Instagram link as a real video — its own player, and
a Save that writes the file to the phone — instead of the platform's embedded
frame. This is how to switch that on.

**It is off by default and PINGO works without it.** Nothing below is needed to
ship, and skipping it costs you the embeds, which already play.

## What PINGO does and does not do

Pulling a media stream out of a platform page cannot happen in a browser, which
is why the websites that do this run a service. PINGO ships only the *client*
for one: it posts a URL to an address you configure and plays the direct URL
that comes back. Nothing in this repository knows how to take a video apart, and
nothing here talks to YouTube or Instagram.

So the service is yours: you run it, and you are the one accepting the terms of
the platforms it fetches from. That decision is not made by installing PINGO.

The service PINGO speaks to is [cobalt](https://github.com/imputnet/cobalt) —
the same software behind most of the "paste a link, get a video" sites, and
self-hostable.

## 1. A machine and a name

You need somewhere that runs Docker and a hostname with HTTPS. The browser will
not call an `http://` endpoint from an `https://` page, and PINGO ignores
anything that is not `https://`.

Any small VPS works. A Cloudflare Tunnel is the least painful route to a
certificate and means nothing has to be exposed directly:

```sh
# on the machine
cloudflared tunnel login
cloudflared tunnel create pingo-media
cloudflared tunnel route dns pingo-media media.example.com
```

Point the tunnel at `http://localhost:9000` in its config, then run it as a
service. Everything below assumes `https://media.example.com/`.

## 2. Bring cobalt up

`docker-compose.yml`:

```yaml
services:
  cobalt-api:
    image: ghcr.io/imputnet/cobalt:10
    init: true
    read_only: true
    restart: unless-stopped
    container_name: cobalt-api
    ports:
      - 127.0.0.1:9000:9000/tcp
    environment:
      # Must match the public address exactly, trailing slash included.
      # cobalt builds its own reply URLs from this, so a mismatch produces
      # links that resolve to nothing.
      API_URL: "https://media.example.com/"

      # Only PINGO's origin may call this from a browser. Without it cobalt
      # answers every site on the internet, and any page could quietly use
      # your instance as its own downloader.
      CORS_WILDCARD: "0"
      CORS_URL: "https://pingochat.pages.dev"

      # A ceiling on what one link may cost you, in seconds. Somebody pasting
      # a twelve-hour stream should not take the instance down.
      DURATION_LIMIT: "1800"
```

```sh
docker compose up -d
```

`127.0.0.1:9000` in `ports` is deliberate: the tunnel reaches it locally and
nothing else can, so the only way in is the hostname you control.

Check it answers:

```sh
curl -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ"}' \
  https://media.example.com/
```

A `status` of `tunnel` or `redirect` with a `url` means it works. That is
exactly the shape PINGO reads.

## 3. Lock it down

CORS is not access control — it restrains browsers and does nothing to `curl`.
An open instance on a public hostname will be found and used.

Turn on cobalt's key auth:

```yaml
      API_AUTH_REQUIRED: "1"
      API_KEY_URL: "file:///keys.json"
```

`keys.json`, mounted into the container:

```json
{
  "3b3b1d3a-0a4f-4a4a-9d1f-2a2f6d5c8e11": {
    "name": "pingo",
    "limit": 60
  }
}
```

Generate the UUID yourself (`uuidgen`). Mount it read-only:

```yaml
    volumes:
      - ./keys.json:/keys.json:ro
```

### What that key is worth

PINGO is a web build, so the key ends up **in the JavaScript bundle** and anyone
holding the app can read it. It is not a secret. What it does is stop a stranger
who finds the endpoint from using it casually, and let you revoke access without
moving the hostname.

If you want the instance genuinely closed, put Cloudflare Access in front of the
tunnel and admit only your own accounts. The key is the cheap measure, not the
strong one.

## 4. Tell PINGO

In `apps/web/.env`:

```
VITE_MEDIA_RESOLVER_URL=https://media.example.com/
VITE_MEDIA_RESOLVER_KEY=3b3b1d3a-0a4f-4a4a-9d1f-2a2f6d5c8e11
```

Leave the key line out if you did not enable auth.

**These are inlined at build time, not read at runtime.** Setting them on
Cloudflare Pages alone does nothing — the value has to be present when
`pnpm build` runs, and a running deployment will not pick up a change until it
is rebuilt.

## 5. Check it

Send a YouTube link in a chat and press play. You should get PINGO's own player
with a **Save** beside the title, rather than the YouTube frame.

If you get the frame instead, the resolver said nothing and the card fell back —
which is the designed behaviour, not a crash. In order of likelihood:

| What you see | Usually means |
| --- | --- |
| The embed plays as before | `VITE_MEDIA_RESOLVER_URL` was not set at build time |
| A CORS error in the console | `CORS_URL` does not match the origin exactly |
| `401` from the resolver | Auth is on and the key is missing or wrong |
| Nothing for one specific link | Private, region-locked, or removed — cobalt cannot see it either |

Remember the service worker: PINGO caches its own bundle, so add `?bust=1` to
the URL when checking a fresh deploy or you will be testing the old one.

## Cost, and who sees what

Every press of play sends that link to your instance, and your instance fetches
the video. So it is your bandwidth, and your server's address that the platform
sees — not the phone's.

It also means the instance learns which links this group watches. That is a
reason to run it yourself rather than point at a public one, and a reason not to
share the hostname.

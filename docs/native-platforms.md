# PINGO on five platforms

One codebase, one UI, one backend. This is what is built, what is not, and what
only you can do.

---

## The architecture

```
                    apps/web  (React + Vite)
                            │
                    pnpm build → dist/
                            │
        ┌───────────┬───────┴───────┬───────────┐
        │           │               │           │
      Web       Android            iOS      Desktop
   Cloudflare  Capacitor        Capacitor    (not yet)
```

**Capacitor hosts the app; it does not port it.** The same `dist/` that
Cloudflare serves is loaded by a native WebView. There is no second UI, no
platform-specific screen, and nothing to keep in sync — a change to a React
component is a change to every platform at once.

What the shell adds is the part a browser cannot give: a real icon, a splash
screen, no address bar, native permission dialogs, the hardware back button,
deep links and push.

`apps/web/src/features/native/shell.ts` is the only file that knows which
platform it is on. Every call in it is skipped in a browser, so the web build is
byte-identical to what it was.

---

## Status

| Platform | State | Blocked on |
| --- | --- | --- |
| Web | **Shipping** | — |
| Android | **Scaffolded, not built** | A JDK on this machine |
| iOS | **Scaffolded only** | A Mac with Xcode |
| Windows | Not started | A decision — see below |
| macOS | Not started | Same |

### What "scaffolded" means

`apps/web/android/` is a real Gradle project. The manifest declares the
permissions PINGO actually uses, the web assets are synced into it, and
`capacitor.config.ts` is configured. What has not happened is a compile,
because this machine has no JDK — so **nothing here has been proven to run.**

Treat the Android project as reviewed-and-plausible, not as working.

---

## What you need to install

### Android

1. **Android Studio** — <https://developer.android.com/studio>. It bundles the
   JDK, which is the missing piece. The SDK itself is already on this machine
   (`%LOCALAPPDATA%\Android\Sdk`, build-tools 36, platform android-36).
2. Then:

```bash
pnpm --filter @pingo/web build
cd apps/web
npx cap sync android
npx cap open android      # opens Android Studio; press Run
```

For a device build from the command line, once the JDK is on PATH:

```bash
cd apps/web/android
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

### iOS

**This cannot be done on Windows.** Not a limitation of the setup — Xcode is
macOS-only and there is no cross-compiler. On a Mac:

```bash
pnpm --filter @pingo/web build
cd apps/web
npx cap add ios
npx cap sync ios
npx cap open ios          # Xcode; set a signing team, then Run
```

A paid Apple Developer account ($99/yr) is required to run on a physical device
or ship to TestFlight.

---

## Decisions only you can make

### 1. Desktop: Tauri or Electron

Not started, deliberately — the two choices differ enough that guessing wrong
means redoing it.

- **Tauri** builds ~10MB installers and uses the OS WebView. Needs the Rust
  toolchain, which is not on this machine.
- **Electron** builds ~150MB installers and ships its own Chromium, so every
  desktop behaves identically.

Tauri is the better fit for a product this size. Electron is the safer one if
you hit a WebView difference you cannot work around.

### 2. Push notifications

**Nothing exists yet — not in the app, not on the server.** The badge is
in-app only. Real push needs, in order:

1. A Firebase project, for FCM. Android and iOS both route through it.
2. An Apple Push certificate, which needs the paid developer account.
3. `@capacitor/push-notifications` wired to register a device token.
4. A table to store tokens against users.
5. A Supabase Edge Function that sends to FCM when a message is inserted.

Steps 1 and 2 are yours — they need accounts and certificates I cannot create.
Steps 3 to 5 are code and I can do them once 1 and 2 exist.

### 3. Supabase redirect URLs

The shell serves the app from `https://localhost`, not from
`pingochat.pages.dev`. **Google sign-in will fail on device until that origin is
added** to Supabase → Authentication → URL Configuration → Redirect URLs.

Add `chat.pingo.app://` and `https://localhost` there before testing auth on a
phone.

---

## What is genuinely done

- Capacitor installed and configured, with `androidScheme: 'https'` — this one
  matters more than it looks. Capacitor's Android default is `http://localhost`,
  which is a **non-secure origin**, and on a non-secure origin
  `navigator.mediaDevices` does not exist. The camera and the entire calling
  stack would be silently absent.
- The Android project, with the permissions PINGO actually uses. Camera and
  microphone are declared `required="false"` so the app stays installable on a
  tablet without a rear camera.
- Splash dismissal driven by the app rather than a timer, so there is no blank
  frame and no dead time.
- Status bar overlaying the WebView and matching the theme, because every screen
  already pads for `env(safe-area-inset-top)`.
- The Android hardware back button, which without handling exits the app from
  anywhere — including from inside a conversation.
- Keyboard height published as a CSS variable, because Android's WebView resize
  is unreliable across manufacturers.

---

## What is not done, stated plainly

- **No APK has been built.** No JDK here.
- **No iOS project exists.** Windows.
- **No desktop app.** Awaiting the Tauri/Electron decision.
- **No push notifications.** Needs your Firebase and Apple accounts first.
- **Local-first sync is not built.** The app caches its shell offline and holds
  what is in memory, but there is no local database, no offline write queue and
  no replay-on-reconnect. That is a substantial piece of work — an IndexedDB
  store, an outbox, and conflict rules — and it is the largest remaining item in
  the brief.

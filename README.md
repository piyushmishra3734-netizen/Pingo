# PINGO

**Connect. Privately.**

A calm, premium communication platform. Web app today; Android and iOS share the
same backend, design language and experience.

The design system is a direct translation of the PINGO branding board. That board
is the single source of truth — colours, type, the monogram, the purple dot, motion.
Nothing in this repo invents a second visual language.

---

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

| Command          | Does                                    |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | Dev server with HMR                     |
| `pnpm build`     | Typecheck + production build            |
| `pnpm preview`   | Serve the production build              |
| `pnpm typecheck` | Typecheck every workspace package       |

---

## Design specification

**[docs/](./docs/README.md) is the product & UX blueprint** — the five laws, the
water/glass/air motion language, every screen's behaviour, all thirteen settings
sections, and 24 components. Read it before designing or building a screen.

The branding board is the source of truth for identity; the blueprint is the source
of truth for behaviour.

---

## Structure

```
pingo/
├─ apps/
│  └─ web/                 React 19 + Vite + Tailwind v4
│     └─ src/
│        ├─ app/           AppShell, floating glass Dock
│        ├─ screens/       One file per route
│        ├─ features/      Composite domain UI (conversations, chat)
│        ├─ components/    Cross-screen pieces (ScreenHeader)
│        └─ styles/        Stylesheet entry point
└─ packages/
   ├─ tokens/              The branding board, as data + Tailwind @theme
   ├─ ui/                  Component library — brand, primitives, icons
   └─ core/                Domain model, ChatService boundary, React bindings
```

### Why it is split this way

`tokens` and `core` contain no styling and no platform assumptions, so a future
`apps/mobile` consumes both unchanged. `ui` is web-specific (Tailwind classes) and
will get a React Native sibling that reads the same tokens.

**`ui` deliberately does not depend on `core`.** Components take primitives —
`name`, `id`, `presence` — not domain objects. That keeps the library reusable if
the model changes, and it is why `initials()` lives in `ui` rather than `core`.

---

## Design system

Tokens live in `packages/tokens`. The Tailwind theme is `src/tokens.css`; the same
values exist as TypeScript objects for native.

| | |
| --- | --- |
| Primary Blue | `#5C6CFF` |
| Primary Purple | `#8B5DFF` — the dot |
| Soft White | `#F8F9FD` |
| Background | `#FBFBFE` |
| Text | `#101114` |
| Secondary | `#6F7282` |
| Gradient | `#6D7CFF → #A16EFF` @ 135° |

Type is Space Grotesk at Display 56 / H1 32 / H2 20 / Body 16 / Caption 12.

### Rules

1. **Never write a raw hex value outside `packages/tokens`.** Use the semantic
   utilities: `bg-surface`, `text-text-secondary`, `border-line`.
2. **Nothing sharper than 8px.** The radius scale has no `0`.
3. **No spring, bounce or elastic easing.** Motion explains a state change and
   never overshoots. Every duration is ≤ 320ms.
4. **The purple dot is the only status vocabulary.** Online, typing, recording,
   loading, notification — all one component, `PingoDot`.
5. **The monogram is the spinner.** `PingoMarkState state="loading"`. There is no
   generic circular spinner anywhere in the product.
6. **New `--text-*` token? Register it in `cn.ts`.** See the note there — without
   it, `tailwind-merge` reads the token as a colour and silently drops real
   colours from the same call.

---

## Data layer

Everything the UI needs is behind `ChatService` (`packages/core/src/chat-service.ts`).
`MockChatService` implements it in memory with realistic behaviour: latency on
reads, optimistic sends that transition `sending → sent → delivered → read`,
self-clearing typing indicators, and a push event stream.

Swapping in a real backend is a one-line change at the composition root:

```tsx
// apps/web/src/App.tsx
<ChatProvider service={new SocketChatService(url)}>
```

Components never poll and never import a concrete implementation.

### Seeded media

Avatars render a deterministic brand-gradient monogram — no bundled stock photos,
no third-party avatar service, and it is what real users see before uploading a
picture. Gallery items carry CSS gradients in `url`, so layout and interaction are
fully exercisable without binary assets.

---

## Accessibility

- `prefers-reduced-motion` stops every ambient loop and collapses transitions
  (`tokens.css`). A product built on calm honours the request for less motion.
- Focus rings are `:focus-visible` only, via the `focus-ring` utility.
- `ListRow` renders a `<button>` only when it is actually actionable — a row
  holding a toggle is not itself a button.
- Filter chips are a real `radiogroup`, so arrow keys work and the set is
  announced as one control.
- Voice notes are a keyboard-operable `slider`.

---

## Status

**Built and verified:** design tokens, component library, mock data layer, and the
screens on the board — Splash, Onboarding, Chats (list + thread), Profile with
gallery, Settings, Calls, Communities, floating glass dock. Responsive from 360px
to desktop two-pane.

**Not built yet:** real backend and cross-device sync (the `ChatService` seam is
ready), `apps/mobile`, live voice/video calling, Moments/Stories UI (the model
exists), dark theme (semantic colour roles are ready for it), and self-hosted
fonts — `index.html` currently loads Space Grotesk from Google Fonts, which a
privacy-first product should replace before launch.

import {
  Avatar,
  CameraIcon,
  ChatIcon,
  ChevronLeftIcon,
  MoreIcon,
  PhoneIcon,
  UserIcon,
  VideoIcon,
  cn,
} from '@pingo/ui';
import { useState } from 'react';

import { AchievementArt, AchievementMark } from '../../features/achievements/AchievementArt.js';
import { ACHIEVEMENTS } from '../../features/achievements/registry.js';
import { Badge } from '../../features/badges/Badge.js';
import { BADGES } from '../../features/badges/registry.js';

/**
 * Four ways the profile could look. Dev-only, at `/dev/profile-lab`.
 *
 * Every variant is a claim with a source behind it, so the choice can be made
 * on the reasoning rather than on which screenshot is prettiest. The quotes are
 * from HIG → Layout unless marked otherwise.
 *
 * Nothing here touches the real `ProfileScreen`. It is mock data on a public
 * route, so it renders with no session, no providers and no network - which is
 * the only way to compare four layouts side by side without four accounts.
 */

/**
 * Real registry entries, not invented ones.
 *
 * FOUNDER is the lead achievement - the mark that sits beside a name and does
 * the job a verified tick does - and the shelf below is the first four badges
 * from the badge registry, two earned and two still locked. Locked ones are
 * shown on purpose: `registry.ts` says a grid of locked badges is what makes
 * the collection feel like somewhere to go.
 */
const LEAD = ACHIEVEMENTS[0]!;
const SHELF = BADGES.slice(0, 4);
const EARNED = 2;

const PERSON = {
  name: 'Anaya Sharma',
  username: 'anaya',
  bio: 'Designing quietly. Chai, long walks, and film photography.',
  posts: 128,
  friends: 342,
  groups: 12,
};

type Variant = 'a' | 'b' | 'c' | 'd' | 'e';

const VARIANTS: { id: Variant; title: string; claim: string; source: string }[] = [
  {
    id: 'a',
    title: 'Reading order',
    claim:
      'Identity moves to the leading edge. A centred profile is a social-media convention; Apple lays out by reading order, and the name is the most important thing on the screen.',
    source:
      '"People often start by viewing items in reading order … place the most important items near the top and leading side."',
  },
  {
    id: 'b',
    title: 'Grouped stats',
    claim:
      'The three numbers become one inset object with separators instead of three columns floating on the page, so they read as a set rather than as three unrelated figures.',
    source:
      '"Group related items … use negative space, background shapes, colors, materials, or separator lines to show when elements are related."',
  },
  {
    id: 'c',
    title: 'No cover',
    claim:
      'The cover band is decoration that costs the top third of the screen. Removing it makes the face and the name the first things, and gives the bio room to be read.',
    source:
      '"Make essential information easy to find by giving it sufficient space … don’t obscure it by crowding it with nonessential details."',
  },
  {
    id: 'e',
    title: 'B, refined',
    claim:
      'B’s structure, taken through the operator’s pass: smaller avatar, tighter name, clamped bio, separators instead of a boxed card, one dominant action with circular secondaries, achievements as a gallery rather than a row of cards, and a quiet header. The rule underneath all of it is that content stays flat and only controls are tactile.',
    source:
      'Corpus: the material is spent on controls, not content, and “overusing this material in multiple custom controls can provide a subpar user experience by distracting from that content.”',
  },
  {
    id: 'd',
    title: 'Full bleed + glass',
    claim:
      'The cover runs to every edge and the actions sit on glass above it, so controls and content are on different planes rather than stacked in the same column.',
    source:
      '"Extend content to fill the screen … Controls and navigation components appear on top of content rather than on the same plane." And: differentiate controls from content with the material.',
  },
];

export function ProfileLookLab() {
  const [variant, setVariant] = useState<Variant>('e');
  const [isSelf, setIsSelf] = useState(true);
  const current = VARIANTS.find((v) => v.id === variant)!;

  return (
    <div className="h-full overflow-y-auto bg-sunken">
      <div className="mx-auto w-full max-w-md px-4 py-5">
        <h1 className="text-h2 text-ink">Profile looks</h1>
        <p className="mt-1 text-caption text-text-tertiary">
          Four directions. Mock data, dev only.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-caption font-medium',
                'transition-colors duration-instant ease-standard',
                variant === v.id
                  ? 'bg-brand text-on-brand'
                  : 'bg-surface text-text-secondary hover:bg-hover',
              )}
            >
              {v.id.toUpperCase()} · {v.title}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-md bg-surface p-3">
          <p className="text-body text-ink">{current.claim}</p>
          <p className="mt-2 text-caption italic text-text-tertiary">{current.source}</p>
        </div>

        {/*
          Whose page this is, because it changes what belongs on it.

          `ProfileScreen` argues the case in its own comments: the shelf is
          yours only, since "on somebody else's page a shelf of badges is a
          score next to their name, and this product does not have scores". The
          mark beside the name stays either way - that is identity, not score.
        */}
        <div className="mt-3 flex items-center gap-2">
          {[
            [true, 'My profile'],
            [false, "Someone else's"],
          ].map(([mine, label]) => (
            <button
              key={String(mine)}
              type="button"
              onClick={() => setIsSelf(mine as boolean)}
              className={cn(
                'rounded-md px-3 py-1.5 text-caption font-medium',
                'transition-colors duration-instant ease-standard',
                isSelf === mine
                  ? 'bg-ink text-page'
                  : 'bg-surface text-text-secondary hover:bg-hover',
              )}
            >
              {label as string}
            </button>
          ))}
        </div>

        {/* The phone, so each variant is judged at the size it ships at. */}
        <div className="mt-5 overflow-hidden rounded-lg bg-page shadow-lg ring-1 ring-line">
          {variant === 'a' && <LookA isSelf={isSelf} />}
          {variant === 'b' && <LookB isSelf={isSelf} />}
          {variant === 'c' && <LookC isSelf={isSelf} />}
          {variant === 'd' && <LookD isSelf={isSelf} />}
          {variant === 'e' && <LookE isSelf={isSelf} />}
        </div>

        <p className="mt-4 pb-8 text-caption text-text-tertiary">
          Same person, same facts, same components in all four. Only the
          arrangement changes.
        </p>
      </div>
    </div>
  );
}


/* -- stand-in photography ---------------------------------------------------

   Drawn here rather than fetched. A design lab that depends on the network
   stops working on a plane, and a lab that reaches a stock-photo host sends a
   request nobody asked for. These are SVG data URIs: a few blurred colour
   fields plus film grain, which at thumbnail and cover size reads as a
   photograph rather than as a placeholder - which is the whole point, since
   grey rectangles cannot tell you whether a layout works.
--------------------------------------------------------------------------- */

/** Deterministic per seed, so a post keeps its picture across re-renders. */
function photo(seed: number, tone: 'warm' | 'cool' | 'dusk' = 'warm'): string {
  const palettes = {
    warm: ['#f4b183', '#e8825c', '#b5533f', '#f7dcc4'],
    cool: ['#8fb8d8', '#4f7fa8', '#2c4a63', '#cfe2ef'],
    dusk: ['#b98fd8', '#7a5aa8', '#3d2c5e', '#e5d6f2'],
  } as const;
  const c = palettes[tone];
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <filter id="b"><feGaussianBlur stdDeviation="42"/></filter>
    <filter id="g">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.14"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="400" height="400" fill="${c[3]}"/>
  <g filter="url(#b)">
    <circle cx="${60 + r(1) * 280}" cy="${40 + r(2) * 200}" r="${120 + r(3) * 90}" fill="${c[0]}"/>
    <circle cx="${40 + r(4) * 320}" cy="${180 + r(5) * 200}" r="${100 + r(6) * 110}" fill="${c[1]}"/>
    <circle cx="${120 + r(7) * 240}" cy="${240 + r(8) * 160}" r="${80 + r(9) * 80}" fill="${c[2]}"/>
  </g>
  <rect width="400" height="400" filter="url(#g)" opacity="0.55"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A face, at the size a face is actually seen.
 *
 * Abstract on purpose: a real portrait would put a stranger in the repo, and at
 * 72px a lit bust silhouette carries everything the layout needs to be judged -
 * that the circle holds a person, and how it sits against the cover behind it.
 */
const PFP = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="bg" cx="35%" cy="25%">
      <stop offset="0%" stop-color="#f6d9c0"/><stop offset="60%" stop-color="#d9906a"/><stop offset="100%" stop-color="#8f4a34"/>
    </radialGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3a2a2a" stop-opacity="0.92"/><stop offset="100%" stop-color="#1d1414" stop-opacity="0.96"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="1.6"/></filter>
  </defs>
  <rect width="200" height="200" fill="url(#bg)"/>
  <g filter="url(#soft)">
    <circle cx="100" cy="78" r="34" fill="url(#s)"/>
    <path d="M32 200c0-40 30-64 68-64s68 24 68 64z" fill="url(#s)"/>
  </g>
  <ellipse cx="86" cy="60" rx="26" ry="18" fill="#ffffff" opacity="0.10"/>
</svg>`)}`;

const COVER = photo(7, 'dusk');
const POSTS = [
  photo(11, 'warm'),
  photo(23, 'cool'),
  photo(37, 'dusk'),
  photo(41, 'warm'),
  photo(59, 'cool'),
  photo(67, 'warm'),
];

/* -- shared pieces ---------------------------------------------------------- */

function Cover({ className }: { className?: string }) {
  return (
    <img
      src={COVER}
      alt=""
      className={cn('w-full bg-sunken object-cover', className)}
      aria-hidden
    />
  );
}

/**
 * Apple: "Avoid full-width buttons. Buttons feel at home in iOS when they
 * respect system-defined margins and are inset from the edges of the screen."
 * So every variant insets its actions rather than running them edge to edge.
 */
function Actions({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={cn(
          'flex h-10 flex-1 items-center justify-center gap-2 rounded-lg',
          'bg-brand-gradient text-on-brand text-body font-medium',
          'transition-transform duration-instant ease-standard active:scale-[0.98]',
        )}
      >
        <ChatIcon size={17} />
        Message
      </button>
      {!compact && (
        <>
          <IconAction label="Voice call">
            <PhoneIcon size={18} />
          </IconAction>
          <IconAction label="Video call">
            <VideoIcon size={18} />
          </IconAction>
        </>
      )}
    </div>
  );
}

function IconAction({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-lg',
        'border border-line bg-surface text-ink',
        'transition-transform duration-instant ease-standard active:scale-[0.96]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The name, with the mark that follows it.
 *
 * `AchievementMark` renders nothing when there is nothing to show, so it is
 * called unconditionally - and it carries its own screen-reader label, because
 * an achievement that only sighted people can perceive is not one.
 */
function NameLine({ centred = false, onCover = false }: { centred?: boolean; onCover?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', centred && 'justify-center')}>
      <h2
        className={cn(
          'truncate text-h2',
          onCover ? 'text-white drop-shadow-sm' : 'text-ink',
        )}
      >
        {PERSON.name}
      </h2>
      <AchievementMark achievement={LEAD} />
    </div>
  );
}

/**
 * The cabinet, and only on your own page.
 *
 * Placed last, under a rule, which is where `ProfileScreen` puts it and why:
 * "a profile in a messenger is mostly personality. Achievements are the last
 * five per cent of it and are placed accordingly."
 */
function Shelf({ isSelf }: { isSelf: boolean }) {
  if (!isSelf) return null;

  return (
    <section className="mt-7 border-t border-line/60 pt-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body font-medium text-ink">Achievements</span>
        <span className="text-caption text-text-tertiary">See all</span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <AchievementArt achievement={LEAD} size="small" className="size-14" />
        <p className="text-body font-medium text-ink">{LEAD.title}</p>
      </div>

      {/* Locked ones stay on the shelf - that is what makes it somewhere to go. */}
      <div className="mt-4 flex gap-3">
        {SHELF.map((badge, i) => (
          <Badge key={badge.id} badge={badge} unlocked={i < EARNED} size={56} />
        ))}
      </div>
    </section>
  );
}

function Bio() {
  return <p className="text-body text-text-secondary">{PERSON.bio}</p>;
}

function Tabs() {
  return (
    <div className="mt-6 flex border-b border-line">
      {['Posts', 'Media'].map((tab, i) => (
        <span
          key={tab}
          className={cn(
            'flex-1 pb-2.5 text-center text-body font-medium',
            i === 0 ? 'border-b-2 border-brand text-ink' : 'text-text-tertiary',
          )}
        >
          {tab}
        </span>
      ))}
    </div>
  );
}

function Grid() {
  return (
    <div className="mt-3 grid grid-cols-3 gap-1 px-4 pb-6">
      {POSTS.map((src, i) => (
        <img
          key={i}
          src={src}
          alt=""
          className="aspect-square w-full rounded-sm bg-sunken object-cover"
          aria-hidden
        />
      ))}
    </div>
  );
}

/* -- A · reading order ------------------------------------------------------ */

function LookA({ isSelf }: { isSelf: boolean }) {
  return (
    <div className="h-[600px] overflow-y-auto">
      <div className="relative">
        <Cover className="h-24" />
      </div>

      {/*
        Avatar and name on one line at the leading edge, which is where reading
        starts. Centring puts the most important item where the eye arrives last.
      */}
      <div className="px-4">
        <div className="-mt-9 flex items-end gap-3">
          <Avatar name={PERSON.name} id="a" src={PFP} size="2xl" className="ring-4 ring-page" />
          <div className="min-w-0 flex-1 pb-1.5">
            <NameLine />
            <p className="text-caption text-text-tertiary">@{PERSON.username}</p>
          </div>
        </div>

        <div className="mt-3">
          <Bio />
        </div>

        <div className="mt-4 flex gap-5">
          <StatInline label="Posts" value={PERSON.posts} />
          <StatInline label="Friends" value={PERSON.friends} />
          <StatInline label="Groups" value={PERSON.groups} />
        </div>

        <div className="mt-4">
          <Actions />
        </div>

        <Shelf isSelf={isSelf} />
        <Tabs />
      </div>
      <Grid />
    </div>
  );
}

function StatInline({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-body font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-caption text-text-tertiary">{label}</span>
    </span>
  );
}

/* -- B · grouped stats ------------------------------------------------------ */

function LookB({ isSelf }: { isSelf: boolean }) {
  return (
    <div className="h-[600px] overflow-y-auto">
      <Cover className="h-28" />

      <div className="px-4">
        <div className="-mt-10 flex justify-center">
          <Avatar name={PERSON.name} id="a" src={PFP} size="2xl" className="ring-4 ring-page" />
        </div>

        <div className="mt-3 text-center">
          <NameLine centred />
          <p className="mt-0.5 text-caption text-text-tertiary">@{PERSON.username}</p>
          <p className="mt-2 text-body text-text-secondary">{PERSON.bio}</p>
        </div>

        {/*
          One object with separator lines, rather than three columns of numbers
          sharing nothing but a row. The separators are the grouping device
          Apple names first.
        */}
        <dl className="mt-5 flex overflow-hidden rounded-lg bg-surface ring-1 ring-line">
          {[
            ['Posts', PERSON.posts],
            ['Friends', PERSON.friends],
            ['Groups', PERSON.groups],
          ].map(([label, value], i) => (
            <div
              key={label as string}
              className={cn(
                'flex-1 py-3 text-center',
                i > 0 && 'border-l border-line',
              )}
            >
              <dd className="text-h2 tabular-nums text-ink">{value}</dd>
              <dt className="mt-0.5 text-caption text-text-tertiary">{label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-4">
          <Actions />
        </div>

        <Shelf isSelf={isSelf} />
        <Tabs />
      </div>
      <Grid />
    </div>
  );
}

/* -- C · no cover ----------------------------------------------------------- */

function LookC({ isSelf }: { isSelf: boolean }) {
  return (
    <div className="h-[600px] overflow-y-auto">
      {/*
        No band at all. The face and the name arrive first, and the bio gets the
        space the cover was spending on a gradient.
      */}
      <div className="px-4 pt-8">
        <div className="flex flex-col items-center text-center">
          <Avatar name={PERSON.name} id="a" src={PFP} size="2xl" />
          <div className="mt-4 flex items-center gap-2">
            <h2 className="text-h1 text-ink">{PERSON.name}</h2>
            <AchievementMark achievement={LEAD} />
          </div>
          <p className="mt-1 text-body text-text-tertiary">@{PERSON.username}</p>
          <p className="mt-3 max-w-[17rem] text-body leading-relaxed text-text-secondary">
            {PERSON.bio}
          </p>
        </div>

        <div className="mt-6 flex justify-center gap-6">
          <StatInline label="Posts" value={PERSON.posts} />
          <StatInline label="Friends" value={PERSON.friends} />
          <StatInline label="Groups" value={PERSON.groups} />
        </div>

        <div className="mt-6">
          <Actions />
        </div>

        <Shelf isSelf={isSelf} />
        <Tabs />
      </div>
      <Grid />
    </div>
  );
}

/* -- D · full bleed + glass ------------------------------------------------- */

function LookD({ isSelf }: { isSelf: boolean }) {
  return (
    <div className="relative h-[600px] overflow-y-auto">
      {/*
        The cover runs under the header rather than starting below it, and the
        controls float on the material - two planes, which is the arrangement
        the guidance describes.
      */}
      <div className="relative">
        <Cover className="h-52" />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <span className="glass-surface grid size-9 place-items-center rounded-full text-ink">
            <UserIcon size={17} />
          </span>
          <span className="glass-surface grid size-9 place-items-center rounded-full text-ink">
            <MoreIcon size={17} />
          </span>
        </div>

        {/* Name over the cover, so the band carries information instead of only colour. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
          <Avatar name={PERSON.name} id="a" src={PFP} size="xl" className="ring-2 ring-white/70" />
          <div className="min-w-0 flex-1 pb-1">
            <NameLine onCover />
            <p className="text-caption text-white/80">@{PERSON.username}</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <Bio />

        <div className="mt-4 flex gap-5">
          <StatInline label="Posts" value={PERSON.posts} />
          <StatInline label="Friends" value={PERSON.friends} />
          <StatInline label="Groups" value={PERSON.groups} />
        </div>

        <div className="mt-4">
          <Actions compact />
          <button
            type="button"
            className={cn(
              'mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg',
              'border border-line bg-surface text-body font-medium text-ink',
            )}
          >
            <CameraIcon size={17} />
            Send a Ping
          </button>
        </div>

        <Shelf isSelf={isSelf} />
        <Tabs />
      </div>
      <Grid />
    </div>
  );
}

/* -- E · B, refined ---------------------------------------------------------

   B's structure with the operator's pass applied. Each change is listed where
   it happens rather than here, because a list at the top is a list nobody reads
   next to the code it describes.

   The rule underneath all of them: content stays flat, controls are tactile,
   and the material is spent only where something is actually interactive. A
   screen where the button, the card, the pill and the container are all glass
   has no hierarchy left to spend.
--------------------------------------------------------------------------- */

function LookE({ isSelf }: { isSelf: boolean }) {
  return (
    <div className="h-[600px] overflow-y-auto bg-page">
      {/*
        The header is a row, not a bar.

        No fill, no border, no blur - three controls and a title on the page
        itself. A container here would be the app announcing its own chrome on
        the screen that is meant to be about a person.
      */}
      <div className="flex h-12 items-center justify-between px-2">
        <button
          type="button"
          aria-label="Back"
          className="grid size-10 place-items-center rounded-full text-ink active:bg-pressed"
        >
          <ChevronLeftIcon size={20} />
        </button>
        <span className="text-body font-medium text-ink">Profile</span>
        <button
          type="button"
          aria-label="More"
          className="grid size-10 place-items-center rounded-full text-ink active:bg-pressed"
        >
          <MoreIcon size={20} />
        </button>
      </div>

      <Cover className="h-28" />

      <div className="px-5">
        {/* Smaller, and pulled up less, so it sits in the page rather than on top of it. */}
        <div className="-mt-8 flex justify-center">
          <Avatar
            name={PERSON.name}
            id="a"
            src={PFP}
            size="xl"
            className="ring-4 ring-page"
          />
        </div>

        {/*
          Name and handle as one block, not two.

          They were a heading and a paragraph with the page's normal rhythm
          between them, which read as two facts. `leading-tight` and a hairline
          gap make them one - a name, said twice.
        */}
        <div className="mt-2.5 text-center">
          <NameLine centred />
          <p className="mt-0.5 text-caption leading-tight text-text-tertiary">
            @{PERSON.username}
          </p>
        </div>

        {/*
          Two lines, and then it stops.

          A profile is an identity, not an information sheet, and a bio allowed
          to run pushes everything anybody came for below the fold. Clamped
          rather than truncated at a character count, so the cut lands on a line
          break instead of mid-word.

          Note for the real screen: the spec asked for "slightly smaller" than
          body. There is no size between `text-body` and `text-caption` in the
          scale, and inventing one here would put the funnel's old habit - a
          number somebody picked once - back into the app. Narrower measure and
          a clamp get the same calm without a new value.
        */}
        <p className="mx-auto mt-2.5 line-clamp-2 max-w-[15rem] text-center text-body leading-snug text-text-secondary">
          {PERSON.bio}
        </p>

        {/*
          Separators, not a box.

          B put the numbers in a card with a ring around it, which grouped them
          correctly and then said "control" - a bordered, filled rectangle is
          the shape of something you press. Hairlines do the grouping and claim
          nothing.
        */}
        <dl className="mt-6 flex">
          {[
            ['Posts', PERSON.posts],
            ['Friends', PERSON.friends],
            ['Groups', PERSON.groups],
          ].map(([label, value], i) => (
            <div
              key={label as string}
              className={cn(
                'flex-1 px-2 py-1 text-center',
                i > 0 && 'border-l border-line/60',
              )}
            >
              <dd className="text-h2 tabular-nums text-ink">{value}</dd>
              <dt className="mt-1 text-caption text-text-tertiary">{label}</dt>
            </div>
          ))}
        </dl>

        {/*
          One action, and two controls.

          Message is the reason anybody opens somebody's profile, so it takes
          the accent and the width. Call and video are circular and quiet -
          secondary controls that read as hardware rather than as three buttons
          competing to be pressed.
        */}
        <div className="mt-6 flex items-center gap-2.5">
          <button
            type="button"
            className={cn(
              'flex h-11 flex-1 items-center justify-center gap-2 rounded-lg',
              'bg-brand-gradient text-on-brand text-body font-medium shadow-brand',
              'transition-transform duration-instant ease-standard active:scale-[0.98]',
            )}
          >
            <ChatIcon size={17} />
            Message
          </button>
          <RoundControl label="Voice call">
            <PhoneIcon size={18} />
          </RoundControl>
          <RoundControl label="Video call">
            <VideoIcon size={18} />
          </RoundControl>
        </div>

        {isSelf && <GalleryShelf />}

        <Tabs />
      </div>
      <Grid />
    </div>
  );
}

function RoundControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-full',
        'bg-sunken text-ink',
        'transition-transform duration-instant ease-standard active:scale-[0.94]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Achievements as a gallery, not a row of cards.
 *
 * The shelf in B gave every badge a container, so four badges arrived as four
 * boxes and the art - which is the only reason a badge is worth showing - had
 * to compete with its own frame. Here the badges sit on the page and scroll
 * sideways, which also stops the section growing a second row the day a fifth
 * one is earned.
 *
 * Still your own page only, for the reason `ProfileScreen` gives: on somebody
 * else's this is a score beside their name, and the product has no scores.
 */
function GalleryShelf() {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-medium text-ink">Achievements</span>
        <span className="text-caption text-text-tertiary">See all</span>
      </div>

      {/* Bleeds to the screen edge so the last badge is cut, which is how a
          row says "there is more" without a chevron saying it. */}
      <div className="-mx-5 mt-3 flex gap-4 overflow-x-auto px-5 pb-1 scrollbar-none">
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <AchievementArt achievement={LEAD} size="small" className="size-14" />
          <span className="text-caption text-text-tertiary">{LEAD.title}</span>
        </div>
        {SHELF.map((badge, i) => (
          <div key={badge.id} className="flex shrink-0 flex-col items-center gap-1.5">
            <Badge badge={badge} unlocked={i < EARNED} size={56} />
            <span className="max-w-[4.5rem] truncate text-caption text-text-tertiary">
              {badge.title}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

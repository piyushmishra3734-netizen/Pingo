/**
 * The badge artwork, drawn from the reference sheet.
 *
 * ## Why these do not use the app's icon system
 *
 * `packages/ui` icons are one deliberate style — geometric, rounded, an even
 * two-pixel stroke — because a toolbar wants its glyphs to disappear into each
 * other. Badges want the opposite: they are objects, looked *at* rather than
 * through, and the reference draws them by hand with an uneven line. Running
 * them through `IconBase` would quietly make them consistent with the toolbar
 * and inconsistent with the sheet, which is the one thing that must not happen.
 *
 * ## How the hand-drawn quality survives being SVG
 *
 * Three things, none of them a filter. The stroke is thin and round-capped, so
 * ends read as pen rather than as cut metal. Paths are drawn with cubic curves
 * that do not quite close or align, because a perfectly symmetrical heart looks
 * printed and a slightly lopsided one looks drawn. And nothing is scaled from a
 * grid: each glyph is authored inside the same 64-unit box at the size it is
 * actually seen.
 *
 * Everything inherits `currentColor` — the badge frame decides whether that is
 * cream on ink or ink on cream, so one path serves both fills.
 */
import type { ReactNode } from 'react';

/** Every glyph is drawn inside this box, so strokes stay the same weight. */
export const ART_BOX = 64;

/** The pen. Thin, round, and never scaled up with the badge. */
const PEN = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** A slightly heavier pass, for the one or two strokes that carry a glyph. */
const PEN_BOLD = { ...PEN, strokeWidth: 2.1 } as const;

export type BadgeArtId =
  | 'first_message'
  | 'night_owl'
  | 'early_bird'
  | 'hundred_messages'
  | 'deep_talk'
  | 'voice_lover'
  | 'first_call'
  | 'ten_hours_together'
  | 'weekend_caller'
  | 'camera_explorer'
  | 'memory_keeper'
  | 'creative_shot'
  | 'first_story'
  | 'story_creator'
  | 'story_master'
  | 'around_together'
  | 'weekly_story'
  | 'trusted_friend'
  | 'first_friend'
  | 'best_circle'
  | 'community_builder'
  | 'ai_buddy'
  | 'study_session'
  | 'goal_planner'
  | 'met_offline'
  | 'coffee_together'
  | 'birthday_wish'
  | 'celebrated_together';

/**
 * A paper plane, thrown.
 *
 * The three speed lines behind it are what make it *sent* rather than a
 * dart — the reference has them, and without them it reads as origami.
 */
const firstMessage = (
  <>
    <path {...PEN} d="M12 30 L52 15 L38 50 L30 37 Z" />
    <path {...PEN} d="M12 30 L30 37 L52 15" />
    <path {...PEN} d="M14 41 H24" />
    <path {...PEN} d="M11 47 H19" />
    <path {...PEN} d="M17 53 H23" />
  </>
);

/** A crescent, a few stars, and two small clouds low in the frame. */
const nightOwl = (
  <>
    <path
      {...PEN}
      d="M40 14a19 19 0 1 0 4 33 15 15 0 0 1-4-33Z"
    />
    <path {...PEN} d="M50 20l1.6 3.4L55 25l-3.4 1.6L50 30l-1.6-3.4L45 25l3.4-1.6Z" />
    <path {...PEN} d="M46 36l1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" />
    <circle {...PEN} cx="55" cy="35" r="0.8" />
    <path {...PEN} d="M12 50c3-3 6-1 7 1 2-3 6-2 7 1H11" />
    <path {...PEN} d="M38 54c3-3 7-1 8 1 2-2 5-1 6 1H37" />
  </>
);

/** A sun just clear of the horizon, with rays and two water lines. */
const earlyBird = (
  <>
    <path {...PEN_BOLD} d="M22 40a10 10 0 0 1 20 0" />
    <path {...PEN} d="M32 20v-6M45 25l4-4M19 25l-4-4M50 38h6M8 38h6" />
    <path {...PEN} d="M10 40h44" />
    <path {...PEN} d="M14 47h36" />
    <path {...PEN} d="M20 53h24" />
  </>
);

/**
 * "100", written rather than set.
 *
 * Drawn as strokes instead of a text node on purpose: a font would be the one
 * printed thing on a sheet of hand-drawn ones, and it would change between
 * devices that have it and devices that do not.
 */
const hundredMessages = (
  <>
    {/*
      The "1" is a flag and a stem, with no foot.

      Drawn with a base serif first, which read as an "L" at badge size — the
      grid showed "L00". A brush-written 1 has the upstroke and nothing at the
      bottom, and that is unambiguous even at 64 pixels.
    */}
    <path {...PEN_BOLD} d="M13 26l6-4v20" />
    <path {...PEN_BOLD} d="M28 22c-4 0-7 5-7 10s3 10 7 10 7-5 7-10-3-10-7-10Z" />
    <path {...PEN_BOLD} d="M46 22c-4 0-7 5-7 10s3 10 7 10 7-5 7-10-3-10-7-10Z" />
    <path {...PEN} d="M12 49c9 2 27 3 40 0" />
  </>
);

/** Two hearts, overlapping, neither of them symmetrical. */
const deepTalk = (
  <>
    <path
      {...PEN}
      d="M30 46C22 40 13 34 13 26c0-5 4-8 8-8 3 0 6 2 7 5 1-3 4-5 7-5 4 0 8 3 8 8 0 8-9 14-13 20Z"
    />
    <path
      {...PEN}
      d="M40 50c-8-6-17-12-17-20 0-5 4-8 8-8 3 0 6 2 7 5 1-3 4-5 7-5 4 0 8 3 8 8 0 8-9 14-13 20Z"
    />
  </>
);

/** A voice note's waveform: uneven bars, tallest in the middle. */
const voiceLover = (
  <>
    {[
      [10, 8],
      [15, 16],
      [20, 10],
      [25, 22],
      [30, 34],
      [35, 26],
      [40, 38],
      [45, 18],
      [50, 26],
      [55, 12],
    ].map(([x, h]) => (
      <path key={x} {...PEN_BOLD} d={`M${x} ${32 - h! / 2} V${32 + h! / 2}`} />
    ))}
  </>
);

/** A handset, tilted, with three short ring lines. */
const firstCall = (
  <>
    <path
      {...PEN}
      d="M18 20c-3 3-3 7 0 12 4 7 11 13 18 16 5 2 9 2 12-1l-6-7-6 3c-4-2-9-7-11-11l3-6Z"
    />
    <path {...PEN} d="M44 16l6-3M47 23l7 0M45 30l6 4" />
  </>
);

/** An hourglass with sand in the lower bulb. */
const tenHours = (
  <>
    <path {...PEN} d="M20 12h24M20 52h24" />
    <path {...PEN} d="M22 12c0 10 10 15 10 20s-10 10-10 20" />
    <path {...PEN} d="M42 12c0 10-10 15-10 20s10 10 10 20" />
    <path {...PEN} d="M26 47c2-5 10-5 12 0" />
    <path {...PEN} d="M32 34v8" />
  </>
);

/** A single heartbeat across the frame — flat, one spike, flat. */
const weekendCaller = (
  <path
    {...PEN_BOLD}
    d="M8 34h12l4-10 5 22 5-26 4 16 4-4h14"
  />
);

/** A compact camera, body and lens. */
const cameraExplorer = (
  <>
    <path {...PEN} d="M12 24h8l3-5h18l3 5h8a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V27a3 3 0 0 1 3-3Z" />
    <circle {...PEN} cx="32" cy="36" r="9" />
    <circle {...PEN} cx="32" cy="36" r="4.5" />
    <path {...PEN} d="M47 28h3" />
  </>
);

/** Two prints, one behind the other, the front one a landscape. */
const memoryKeeper = (
  <>
    <path {...PEN} d="M26 16h26v26H26z" />
    <path {...PEN} d="M12 22h26v26H12z" />
    <path {...PEN} d="M12 41l8-8 5 5 6-7 7 9" />
    <circle {...PEN} cx="20" cy="29" r="2.6" />
  </>
);

/** A four-point star, drawn with concave sides so it reads as a sparkle. */
const creativeShot = (
  <>
    <path
      {...PEN_BOLD}
      d="M32 10c2 12 8 18 20 20-12 2-18 8-20 20-2-12-8-18-20-20 12-2 18-8 20-20Z"
    />
    <path {...PEN} d="M16 16l3 3M48 16l-3 3M16 48l3-3M48 48l-3-3" />
  </>
);

/** The story ring: a rounded frame with a plus, drawn with the app's own arc. */
const firstStory = (
  <>
    <path {...PEN_BOLD} d="M22 12h20a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8V20a8 8 0 0 1 8-8Z" />
    <path {...PEN_BOLD} d="M32 24v16M24 32h16" />
  </>
);

/** A brushed ring — deliberately not a clean circle. */
const storyCreator = (
  <>
    <path
      {...PEN}
      strokeWidth={4.5}
      d="M32 12c11 0 20 9 20 20s-9 20-20 20-20-9-20-20 8-20 20-20Z"
    />
    <path {...PEN} strokeWidth={2} d="M18 22c-2 4-3 8-2 12" opacity={0.55} />
  </>
);

/** A crown with three points and small dots above each. */
const storyMaster = (
  <>
    <path {...PEN_BOLD} d="M12 46l-2-22 11 9 11-16 11 16 11-9-2 22Z" />
    <path {...PEN} d="M12 50h40" />
    <circle {...PEN} cx="10" cy="20" r="1.6" />
    <circle {...PEN} cx="32" cy="13" r="1.6" />
    <circle {...PEN} cx="54" cy="20" r="1.6" />
  </>
);

/**
 * A globe with three places marked on it.
 *
 * This replaced a flame. A flame meant *viral* — an audience, growing — and
 * this badge is now about friends who are somewhere else being part of your
 * day, so the glyph has to be places rather than spread. The three dots are
 * solid because they are people; the globe stays drawn so it does not turn into
 * an icon of the internet.
 */
const aroundTogether = (
  <>
    <circle {...PEN_BOLD} cx="32" cy="32" r="20" />
    <path {...PEN} d="M12 32h40" />
    <path {...PEN} d="M32 12c6 6 9 13 9 20s-3 14-9 20c-6-6-9-13-9-20s3-14 9-20Z" />
    <circle fill="currentColor" cx="24" cy="22" r="2.6" />
    <circle fill="currentColor" cx="43" cy="30" r="2.6" />
    <circle fill="currentColor" cx="28" cy="44" r="2.6" />
  </>
);

/** A page-a-week calendar with a star on it. */
const weeklyStory = (
  <>
    <path {...PEN} d="M13 18h38v34H13z" />
    <path {...PEN} d="M13 27h38" />
    <path {...PEN} d="M21 12v10M32 12v10M43 12v10" />
    <path
      {...PEN}
      d="M32 32l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"
    />
  </>
);

/** Two hands meeting. The one glyph that has to look drawn, not diagrammed. */
const trustedFriend = (
  <>
    <path {...PEN} d="M6 30l10-6 10 5 6-2 8 3" />
    <path {...PEN} d="M58 30l-10-6-10 5" />
    <path {...PEN} d="M18 33c3 3 7 6 11 7 3 1 6 0 8-2" />
    <path {...PEN} d="M46 33c-3 3-7 6-11 7" />
    <path {...PEN} d="M26 40l5 4M33 38l5 4" />
  </>
);

/** Three people, the middle one forward. Solid, as drawn. */
const firstFriend = (
  <>
    <circle fill="currentColor" cx="32" cy="24" r="7" />
    <path fill="currentColor" d="M32 34c-8 0-13 5-13 12v4h26v-4c0-7-5-12-13-12Z" />
    <circle fill="currentColor" cx="14" cy="28" r="5.5" opacity={0.85} />
    <path fill="currentColor" opacity={0.85} d="M14 36c-6 0-9 4-9 9v5h9V36Z" />
    <circle fill="currentColor" cx="50" cy="28" r="5.5" opacity={0.85} />
    <path fill="currentColor" opacity={0.85} d="M50 36c6 0 9 4 9 9v5h-9V36Z" />
  </>
);

/** One heart, hand-drawn, with the brush overshooting slightly at the top. */
const bestCircle = (
  <>
    <path
      {...PEN}
      strokeWidth={3.4}
      d="M32 50C21 42 10 34 10 24c0-6 5-10 11-10 5 0 9 3 11 7 2-4 6-7 11-7 6 0 11 4 11 10 0 10-11 18-22 26Z"
    />
    <path {...PEN} strokeWidth={2} d="M20 15c-2 1-4 3-5 5" opacity={0.5} />
  </>
);

/** A megaphone with three sound lines. */
const communityBuilder = (
  <>
    <path {...PEN} d="M14 28l24-11v30L14 36a4 4 0 0 1 0-8Z" />
    <path {...PEN} d="M20 37v10a3 3 0 0 0 6 0v-8" />
    <path {...PEN} d="M44 24c3 3 3 13 0 16" />
    <path {...PEN} d="M49 20c5 5 5 19 0 24" />
  </>
);

/** A friendly head: rounded, two eyes, one antenna. */
const aiBuddy = (
  <>
    <path {...PEN} d="M20 22h24a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6Z" />
    <circle fill="currentColor" cx="25" cy="35" r="3.2" />
    <circle fill="currentColor" cx="39" cy="35" r="3.2" />
    <path {...PEN} d="M32 22v-6" />
    <circle {...PEN} cx="32" cy="13" r="2.4" />
    <path {...PEN} d="M14 32h-4M50 32h4" />
  </>
);

/** An open book, pages fanned. */
const studySession = (
  <>
    <path {...PEN} d="M32 22c-5-4-13-6-22-5v28c9-1 17 1 22 5 5-4 13-6 22-5V17c-9-1-17 1-22 5Z" />
    <path {...PEN} d="M32 22v28" />
    <path {...PEN} d="M15 25c5-1 9 0 12 2M15 32c5-1 9 0 12 2" opacity={0.65} />
    <path {...PEN} d="M49 25c-5-1-9 0-12 2M49 32c-5-1-9 0-12 2" opacity={0.65} />
  </>
);

/** A target with an arrow already in it, off-centre by a hair. */
const goalPlanner = (
  <>
    <circle {...PEN_BOLD} cx="30" cy="34" r="20" />
    <circle {...PEN_BOLD} cx="30" cy="34" r="12" />
    <circle fill="currentColor" cx="30" cy="34" r="4" />
    <path {...PEN_BOLD} d="M30 34L54 10" />
    <path {...PEN} d="M46 10h8v8" />
  </>
);

/*
 * — Real Life ————————————————————————————————————————————————————
 *
 * Four glyphs about the app being put down. They are drawn with the same pen as
 * the rest — the temptation with a new category is to mark it as special with a
 * heavier line or a new shape language, and that is exactly how a sheet stops
 * being one sheet.
 */

/** Two pins on a ground line, one nearer than the other, meeting at a place. */
const metOffline = (
  <>
    <path {...PEN} d="M9 52h46" />
    <path {...PEN_BOLD} d="M24 48c-6-8-9-12-9-16a9 9 0 0 1 18 0c0 4-3 8-9 16Z" />
    <circle {...PEN} cx="24" cy="31" r="3.4" />
    <path {...PEN} d="M43 48c-5-6-7-10-7-13a7 7 0 0 1 14 0c0 3-2 7-7 13Z" />
    <circle {...PEN} cx="43" cy="34" r="2.6" />
  </>
);

/** Two cups on a table, one with a handle, steam over both. */
const coffeeTogether = (
  <>
    <path {...PEN_BOLD} d="M12 29h17v10a8.5 8.5 0 0 1-17 0Z" />
    <path {...PEN} d="M29 31h3.5a4 4 0 0 1 0 8H29" />
    <path {...PEN} d="M9 50h23" />
    <path {...PEN} d="M38 31h14v8a7 7 0 0 1-14 0Z" />
    <path {...PEN} d="M35 50h17" />
    <path {...PEN} d="M18 23c-2-3 2-4 0-7M25 23c-2-3 2-4 0-7" opacity={0.75} />
    <path {...PEN} d="M45 25c-2-2 2-3 0-6" opacity={0.75} />
  </>
);

/** A cake with one candle. One, because it is a birthday and not an age. */
const birthdayWish = (
  <>
    <path {...PEN_BOLD} d="M13 34h38v15a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3Z" />
    <path {...PEN} d="M13 42h38" />
    <path {...PEN} d="M32 34V24" />
    <path {...PEN} d="M32 16c3 3 3.5 5 0 8-3.5-3-3-5 0-8Z" />
    <path {...PEN} d="M24 21l-2-2M40 21l2-2" opacity={0.7} />
  </>
);

/** A popper going off, with the confetti drawn as separate marks. */
const celebratedTogether = (
  <>
    <path {...PEN_BOLD} d="M11 53l13-27 14 14Z" />
    <path {...PEN} d="M19 39l10 10" opacity={0.55} />
    <path {...PEN} d="M33 20l3-4M41 25l5-2M39 13l1-5M47 33l6 0M45 41l4 3" />
    <circle fill="currentColor" cx="45" cy="17" r="1.8" />
    <circle fill="currentColor" cx="53" cy="24" r="1.8" />
    <circle fill="currentColor" cx="36" cy="8" r="1.5" />
  </>
);

const ART: Record<BadgeArtId, ReactNode> = {
  first_message: firstMessage,
  night_owl: nightOwl,
  early_bird: earlyBird,
  hundred_messages: hundredMessages,
  deep_talk: deepTalk,
  voice_lover: voiceLover,
  first_call: firstCall,
  ten_hours_together: tenHours,
  weekend_caller: weekendCaller,
  camera_explorer: cameraExplorer,
  memory_keeper: memoryKeeper,
  creative_shot: creativeShot,
  first_story: firstStory,
  story_creator: storyCreator,
  story_master: storyMaster,
  around_together: aroundTogether,
  weekly_story: weeklyStory,
  trusted_friend: trustedFriend,
  first_friend: firstFriend,
  best_circle: bestCircle,
  community_builder: communityBuilder,
  ai_buddy: aiBuddy,
  study_session: studySession,
  goal_planner: goalPlanner,
  met_offline: metOffline,
  coffee_together: coffeeTogether,
  birthday_wish: birthdayWish,
  celebrated_together: celebratedTogether,
};

/** Every id the sheet defines, for the registry check. */
export const BADGE_ART_IDS = Object.keys(ART) as BadgeArtId[];

export function BadgeArt({ id, size = 64 }: { id: BadgeArtId; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${ART_BOX} ${ART_BOX}`}
      aria-hidden
      focusable="false"
    >
      {ART[id]}
    </svg>
  );
}

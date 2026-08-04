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
  | 'viral_story'
  | 'weekly_story'
  | 'trusted_friend'
  | 'first_friend'
  | 'best_circle'
  | 'community_builder'
  | 'ai_buddy'
  | 'study_session'
  | 'goal_planner';

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
    <path {...PEN_BOLD} d="M16 22c-2 1-3 3-3 6v14" />
    <path {...PEN_BOLD} d="M12 42h9" />
    <path {...PEN_BOLD} d="M28 24c-4 0-6 4-6 9s2 9 6 9 6-4 6-9-2-9-6-9Z" />
    <path {...PEN_BOLD} d="M45 24c-4 0-6 4-6 9s2 9 6 9 6-4 6-9-2-9-6-9Z" />
    <path {...PEN} d="M12 49c9 2 26 3 39 0" />
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

/** A flame, filled rather than outlined — the one solid glyph in the set. */
const viralStory = (
  <>
    <path
      fill="currentColor"
      d="M32 8c6 9 3 13 7 16 3-2 3-5 3-7 6 6 8 13 8 19 0 11-8 18-18 18S14 47 14 36c0-8 5-15 10-19 3 3 2 6 4 7 4-4 1-9 4-16Z"
    />
    <path
      fill="currentColor"
      opacity={0.35}
      d="M32 30c3 4 2 6 4 8 1-1 1-3 1-4 3 3 4 7 4 10 0 5-4 9-9 9s-9-4-9-9c0-4 2-8 5-10 2 2 1 3 2 4 2-2 0-5 2-8Z"
    />
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
  viral_story: viralStory,
  weekly_story: weeklyStory,
  trusted_friend: trustedFriend,
  first_friend: firstFriend,
  best_circle: bestCircle,
  community_builder: communityBuilder,
  ai_buddy: aiBuddy,
  study_session: studySession,
  goal_planner: goalPlanner,
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

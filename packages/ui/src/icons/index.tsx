/**
 * The PINGO icon set.
 *
 * Every glyph is drawn on the same 24×24 grid with the same 2px rounded stroke,
 * and every one is geometry only — no fills, no two-tone, no gradients. That
 * restraint is what makes a mixed row of them look like one family.
 *
 * Shapes favour the simplest reading of the idea: a chat is a rounded bubble, a
 * community is two overlapping people, privacy is a shield. Nothing is drawn
 * with more strokes than the idea needs.
 */

import { IconBase, type IconProps } from './Icon.js';

export type { IconProps };

// ---------------------------------------------------------------------------
// Navigation — the four dock destinations, plus their supporting glyphs
// ---------------------------------------------------------------------------

export const ChatIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-3.6-.7L4 21l1.4-4.2A8.4 8.4 0 0 1 4.5 12 8.38 8.38 0 0 1 13 3.5a8.38 8.38 0 0 1 8 8Z" />
  </IconBase>
);

export const PhoneIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M15.8 21a2.2 2.2 0 0 0 2.2-2.2v-2a1.4 1.4 0 0 0-1.2-1.4l-2.2-.3a1.4 1.4 0 0 0-1.3.6l-.7 1a13.6 13.6 0 0 1-4.3-4.3l1-.7a1.4 1.4 0 0 0 .6-1.3l-.3-2.2A1.4 1.4 0 0 0 8.2 7h-2A2.2 2.2 0 0 0 4 9.2C4 15.7 9.3 21 15.8 21Z" />
  </IconBase>
);

export const VideoIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="3.2" />
    <path d="M15.5 12.6l3.9 2.7a1 1 0 0 0 1.6-.8V9.5a1 1 0 0 0-1.6-.8l-3.9 2.7Z" />
  </IconBase>
);

/** Camera off. Same slash treatment as `MicOffIcon`, so the in-call row reads as a set. */
export const VideoOffIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M10.5 6.5h1.8a3.2 3.2 0 0 1 3.2 3.2v1.6" />
    <path d="M15.5 15.2a3.2 3.2 0 0 1-3.2 2.3H6.2A3.2 3.2 0 0 1 3 14.3V9.7a3.2 3.2 0 0 1 2.4-3.1" />
    <path d="M15.5 12.6l3.9 2.7a1 1 0 0 0 1.6-.8V9.5a1 1 0 0 0-1.6-.8l-2 1.4" />
    <path d="m4 4 16 16" />
  </IconBase>
);

/** Flip between front and rear camera: a camera with a rotation arrow around it. */
export const CameraFlipIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4.6 8.5a8 8 0 0 1 13-2.2" />
    <path d="M19.4 15.5a8 8 0 0 1-13 2.2" />
    <path d="M17.8 2.9v3.6h-3.6" />
    <path d="M6.2 21.1v-3.6h3.6" />
    <circle cx="12" cy="12" r="2.6" />
  </IconBase>
);

export const UsersIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="9.5" cy="8.5" r="3.5" />
    <path d="M3.5 19.2a6 6 0 0 1 12 0" />
    <path d="M16 5.4a3.5 3.5 0 0 1 0 6.2" />
    <path d="M17.6 14.2a6 6 0 0 1 3 5" />
  </IconBase>
);

export const UserIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M5 19.5a7 7 0 0 1 14 0" />
  </IconBase>
);

export const BellIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.7 17.4a.6.6 0 0 0 .5.9h13.6a.6.6 0 0 0 .5-.9L18 15.5Z" />
    <path d="M10 21.2a2.4 2.4 0 0 0 4 0" />
  </IconBase>
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const SearchIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="M15.6 15.6 20 20" />
  </IconBase>
);

export const PlusIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 5.5v13M5.5 12h13" />
  </IconBase>
);

/** The composer's send control: a paper plane, matching the board. */
export const SendIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M20.2 4.3 3.9 10.1a.7.7 0 0 0 0 1.3l6.3 2.1 2.1 6.3a.7.7 0 0 0 1.3 0l5.8-16.3a.7.7 0 0 0-.9-.9Z" />
    <path d="M10.2 13.5 20.2 4.3" />
  </IconBase>
);

export const SmileIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M9 14.4a4 4 0 0 0 6 0" />
    <path d="M9.3 9.6h.01M14.7 9.6h.01" />
  </IconBase>
);

export const MicIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="9" y="3" width="6" height="10.5" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3" />
  </IconBase>
);

/** Muted microphone. Same slash treatment as `EyeOffIcon`, so the pair reads as a pair. */
export const MicOffIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M15 5a3 3 0 0 0-6 0v4" />
    <path d="M9 12.2a3 3 0 0 0 5.1 1.9" />
    <path d="M18.5 11.5a6.5 6.5 0 0 1-1 3.4" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 9.6 5.7" />
    <path d="M12 18v3" />
    <path d="m4 4 16 16" />
  </IconBase>
);

export const PaperclipIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M20 11.5 12.4 19a4.6 4.6 0 0 1-6.5-6.5l7.3-7.3a3 3 0 0 1 4.3 4.3l-7.3 7.3a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6" />
  </IconBase>
);

export const PlayIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M8.5 5.6a.8.8 0 0 1 1.2-.7l8.4 6.4a.8.8 0 0 1 0 1.4l-8.4 6.4a.8.8 0 0 1-1.2-.7V5.6Z" />
  </IconBase>
);

export const PauseIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9.5 5.5v13M14.5 5.5v13" />
  </IconBase>
);

export const CameraIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h.9a2 2 0 0 0 1.7-1l.5-.8a1.6 1.6 0 0 1 1.3-.7h2.2a1.6 1.6 0 0 1 1.3.7l.5.8a2 2 0 0 0 1.7 1h.9A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-7Z" />
    <circle cx="12" cy="13" r="3.2" />
  </IconBase>
);

// ---------------------------------------------------------------------------
// Direction & confirmation
// ---------------------------------------------------------------------------

export const ChevronLeftIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </IconBase>
);

export const ChevronRightIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </IconBase>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M19 12H5" />
    <path d="M11 6 5 12l6 6" />
  </IconBase>
);

export const CheckIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M5 12.8 9.5 17 19 7" />
  </IconBase>
);

/** Read receipt. Two overlapping checks, as on the outgoing bubble. */
export const CheckDoubleIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M2.5 12.8 6.5 17 15 7.5" />
    <path d="M10.5 15.4 12.5 17.4 21.5 7.5" />
  </IconBase>
);

export const CloseIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
  </IconBase>
);

/** Horizontal overflow, used in the chat header. */
export const MoreIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </IconBase>
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const AccountIcon = UserIcon;

/**
 * The gear, for the Chats header's settings control.
 *
 * Not on the branding board — its icon panel shows six glyphs and none of them
 * is a gear. Drawn to the board's stated rules instead (rounded, 2px stroke,
 * minimal).
 *
 * Three rings, not two: hole, body, teeth. A first attempt drew only the hole
 * and eight long spokes, and at 21px it read as a **sun** — without the body
 * ring there is nothing for the teeth to be attached to, so the eye sees rays.
 * The body circle is what makes it a gear.
 */
export const SettingsIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="2.6" />
    <circle cx="12" cy="12" r="6.6" />
    <path d="M12 3.2v1.8M12 19v1.8M20.8 12H19M5 12H3.2M18.2 5.8l-1.3 1.3M7.1 16.9l-1.3 1.3M18.2 18.2l-1.3-1.3M7.1 7.1 5.8 5.8" />
  </IconBase>
);

export const ShieldIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3.2 5.5 5.6v5.9c0 3.9 2.6 7.4 6.5 8.9 3.9-1.5 6.5-5 6.5-8.9V5.6L12 3.2Z" />
    <path d="M9.4 12.1 11.4 14l3.4-3.8" />
  </IconBase>
);

export const PaletteIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="11" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="11" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="15.4" r="1.1" fill="currentColor" stroke="none" />
  </IconBase>
);

export const StorageIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="3.5" y="4.5" width="17" height="6" rx="2.4" />
    <rect x="3.5" y="13.5" width="17" height="6" rx="2.4" />
    <path d="M7.5 7.5h.01M7.5 16.5h.01" />
  </IconBase>
);

export const HelpIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1.1.9-1.1 1.6v.3" />
    <path d="M12 17h.01" />
  </IconBase>
);

export const InfoIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 11v5.5" />
    <path d="M12 7.8h.01" />
  </IconBase>
);

export const LockIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="4.8" y="10.5" width="14.4" height="9.5" rx="3" />
    <path d="M8.4 10.5V8a3.6 3.6 0 0 1 7.2 0v2.5" />
  </IconBase>
);

// ---------------------------------------------------------------------------
// Conversation state & media
// ---------------------------------------------------------------------------

export const PinIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 14.5V21" />
    <path d="M8 4h8l-1 6.2 2.2 2.1a.7.7 0 0 1-.5 1.2H7.3a.7.7 0 0 1-.5-1.2L9 10.2 8 4Z" />
  </IconBase>
);

export const MuteIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M11 5.5 6.8 9H4.2a.7.7 0 0 0-.7.7v4.6a.7.7 0 0 0 .7.7h2.6L11 18.5a.6.6 0 0 0 1-.5V6a.6.6 0 0 0-1-.5Z" />
    <path d="M16 9.8l4.4 4.4M20.4 9.8 16 14.2" />
  </IconBase>
);

export const StarIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m12 4.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.6l-4.8 2.5.9-5.4L4.2 9.9l5.4-.8L12 4.2Z" />
  </IconBase>
);

export const ImageIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3.2" />
    <circle cx="9" cy="10" r="1.7" />
    <path d="M4.2 17.2 9 13l4 3.4 2.6-2.2 4.2 3.6" />
  </IconBase>
);

export const FileIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M13.5 3.5H7.8A2.3 2.3 0 0 0 5.5 5.8v12.4a2.3 2.3 0 0 0 2.3 2.3h8.4a2.3 2.3 0 0 0 2.3-2.3V8.5l-5-5Z" />
    <path d="M13.5 3.5v3.2a1.8 1.8 0 0 0 1.8 1.8h3.2" />
  </IconBase>
);

export const GridIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="4" y="4" width="7" height="7" rx="2.2" />
    <rect x="13" y="4" width="7" height="7" rx="2.2" />
    <rect x="4" y="13" width="7" height="7" rx="2.2" />
    <rect x="13" y="13" width="7" height="7" rx="2.2" />
  </IconBase>
);

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * The Email sign-in method's glyph — docs/01 § 4.2.
 *
 * Drawn rather than typed as the character `@`, so it carries the set's stroke
 * weight and sits on the same optical grid as the row icons beside it.
 */
export const AtIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3.4" />
    <path d="M15.4 8.6v4.6a2.4 2.4 0 0 0 4.8 0V12a8.2 8.2 0 1 0-3.2 6.5" />
  </IconBase>
);

/**
 * The password reveal toggle — docs/01 § 8.
 *
 * `EyeIcon` shows the *action* (reveal), not the state, which is why the crossed
 * variant appears only while the password is visible.
 */
export const EyeIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12Z" />
    <circle cx="12" cy="12" r="2.9" />
  </IconBase>
);

export const EyeOffIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9.9 6.2A8.5 8.5 0 0 1 12 5.9c6 0 9.4 6.1 9.4 6.1a16.4 16.4 0 0 1-2.7 3.4" />
    <path d="M6.4 8A16.5 16.5 0 0 0 2.6 12S6 18.1 12 18.1a8.9 8.9 0 0 0 3.5-.7" />
    <path d="M10 10a2.9 2.9 0 0 0 4 4" />
    <path d="m4 4 16 16" />
  </IconBase>
);

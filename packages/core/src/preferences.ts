/**
 * Every preference in PINGO, in one shape.
 *
 * ## Where these live, and why it is not the database
 *
 * All of it is stored on the device. That is the right home for most of it  - 
 * theme, font size, which camera opens first - and it is an *honest* home for
 * the rest, because nothing on the server reads these yet.
 *
 * Two groups will move when there is something to enforce them:
 *
 * | Group | Moves when |
 * | --- | --- |
 * | `privacy` | The server can actually refuse a call or a friend request |
 * | `notifications` | Push exists and the server decides what to send |
 *
 * Storing them in the database *now* would be worse, not better: a row saying
 * "nobody can call me" that no code consults is a promise the product is not
 * keeping, and it would read as enforced to anyone who found it.
 *
 * So a toggle here saves a real preference and changes nothing else yet. That
 * is a smaller lie than a switch that does not even remember what you chose,
 * and every screen says which is which.
 */

import type { AppearanceSettings, MythicPreferences } from './settings.js';
import { DEFAULT_APPEARANCE, DEFAULT_MYTHIC } from './settings.js';

export type Audience = 'everyone' | 'friends' | 'nobody';
export type AddAudience = 'everyone' | 'friends-of-friends' | 'nobody';
export type FontSize = 'small' | 'medium' | 'large';
export type AutoDownload = 'always' | 'wifi' | 'never';
export type UploadQuality = 'auto' | 'high' | 'data-saver';
export type CameraFacing = 'front' | 'back';

/**
 * How much of a notification a locked screen is allowed to show.
 *
 * `sender-only` keeps the product's privacy claim whole: no message text ever
 * enters a push payload, so nothing readable passes through Google's servers on
 * its way to a lock screen. `sender-and-text` is a trade somebody may choose to
 * make about their own messages - it is offered, it is explained, and it is not
 * the default.
 */
export type LockScreenPreview = 'sender-only' | 'sender-and-text' | 'hidden';

/**
 * What is worth interrupting somebody for.
 *
 * Split along one line: things another person did, and things PINGO wants. The
 * first group defaults on, because a messenger that stays quiet about messages
 * is broken. The second defaults off, because a product should have to earn the
 * right to interrupt you about its own goals rather than be granted it silently.
 *
 * These live on the server. They used to live in `localStorage`, which meant
 * the thing doing the sending could not read them - a person could switch
 * notifications off and keep receiving them.
 */
export interface NotificationPreferences {
  /** Overrides everything below while on. */
  muteAll: boolean;

  // Things a person did.
  messages: boolean;
  groups: boolean;
  calls: boolean;
  friendRequests: boolean;
  stories: boolean;
  ai: boolean;

  // Things PINGO would like to say. Off until asked for.
  journey: boolean;
  marketing: boolean;

  preview: LockScreenPreview;

  quietHours: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface PrivacyPreferences {
  whoCanCall: Audience;
  whoCanAdd: AddAudience;
  profileVisibility: Audience;
  onlineStatus: boolean;
  readReceipts: boolean;
  screenshotAlerts: boolean;
}

export interface ChatPreferences {
  /** Live: scales the root font size, so the whole product resizes. */
  fontSize: FontSize;
  bubbleStyle: 'rounded' | 'classic';
  autoDownload: AutoDownload;
  /** Live: the composer already reads this. */
  enterToSend: boolean;
  /** Live: turns the chat list's swipe gestures off entirely. */
  swipeActions: boolean;
  /**
   * Live: whether an archived chat stays archived when a message arrives.
   *
   * Resolved by comparing `archivedAt` against the newest message rather than by
   * writing anything, so both answers are pure functions of state - nothing has
   * to be running at the moment a message lands, and changing this re-sorts the
   * list that already exists instead of only applying from now on.
   */
  keepArchived: boolean;
  /**
   * Soft-place PINGO AI near the top of Chats.
   *
   * Unread human chats still rank above it. Not a hard pin the user has to
   * manage - turn off to use ordinary pin + recency only.
   */
  pinAiToTop: boolean;
}

export interface CameraPreferences {
  /** Live: which camera `getUserMedia` opens. */
  defaultCamera: CameraFacing;
  filters: boolean;
  beauty: boolean;
  hdr: boolean;
  saveSnaps: boolean;
  /** Live: whether the preview is mirrored. */
  mirror: boolean;
  uploadQuality: UploadQuality;
}

export interface CallPreferences {
  noiseCancellation: boolean;
  echoCancellation: boolean;
  hdAudio: boolean;
  hdVideo: boolean;
  cameraOnByDefault: boolean;
}

export interface AdvancedPreferences {
  developerMode: boolean;
  experimentalFeatures: boolean;
  betaFeatures: boolean;
  debugLogs: boolean;
}

export interface Preferences {
  appearance: AppearanceSettings;
  notifications: NotificationPreferences;
  privacy: PrivacyPreferences;
  chats: ChatPreferences;
  camera: CameraPreferences;
  calls: CallPreferences;
  advanced: AdvancedPreferences;
  /**
   * How this account draws what it has earned.
   *
   * Inert until something is earned, which is why it can sit here for
   * everybody rather than appearing only for the accounts that have a badge.
   */
  mythic: MythicPreferences;
  language: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: DEFAULT_APPEARANCE,
  notifications: {
    muteAll: false,
    messages: true,
    groups: true,
    calls: true,
    friendRequests: true,
    stories: true,
    ai: true,
    /*
     * Off, and this one is a philosophy commitment rather than a taste.
     * docs/journey-philosophy.md: never pressure, never punish, never
     * manipulate. "Your streak is about to break" is all three at once, which
     * is why the streak reminder that used to default to `true` here is gone
     * rather than merely switched off.
     */
    journey: false,
    marketing: false,
    preview: 'sender-only',
    quietHours: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  },
  privacy: {
    // Open by default, because a messaging product nobody can reach is not one.
    whoCanCall: 'everyone',
    whoCanAdd: 'everyone',
    profileVisibility: 'everyone',
    onlineStatus: true,
    readReceipts: true,
    // Off by default: an alert that fires on a screenshot we cannot reliably
    // detect would be a promise the platform will not keep.
    screenshotAlerts: false,
  },
  chats: {
    fontSize: 'medium',
    bubbleStyle: 'rounded',
    autoDownload: 'wifi',
    enterToSend: true,
    swipeActions: true,
    // Staying archived is the point of archiving. Anyone who wants the chat
    // back on every message can say so, but that is the surprising answer.
    keepArchived: true,
    pinAiToTop: true,
  },
  camera: {
    defaultCamera: 'front',
    filters: true,
    beauty: false,
    hdr: true,
    saveSnaps: true,
    mirror: true,
    uploadQuality: 'auto',
  },
  calls: {
    noiseCancellation: true,
    echoCancellation: true,
    hdAudio: true,
    /*
     * On, now that an SFU carries the call.
     *
     * This was off, and it made every video call 640x480 by default while
     * audio shipped HD - a picture with a quarter of 720p's pixels, stretched
     * over a phone screen. The reason was the peer-to-peer mesh: the sender
     * uploaded one copy of their camera *per participant*, so resolution was
     * charged to them again for every person on the call.
     *
     * LiveKit removed that. One upload reaches everybody, and simulcast means
     * a device that cannot take the top layer is sent a smaller one rather
     * than everybody being held to the weakest link. The conservative default
     * was answering a question that no longer gets asked.
     *
     * The setting stays, and off is now a data saver rather than the norm.
     */
    hdVideo: true,
    cameraOnByDefault: true,
  },
  advanced: {
    developerMode: false,
    experimentalFeatures: false,
    betaFeatures: false,
    debugLogs: false,
  },
  mythic: DEFAULT_MYTHIC,
  language: 'en',
};

/** The root font sizes behind the Chats → Font Size control. */
export const FONT_SCALE: Record<FontSize, string> = {
  small: '15px',
  medium: '16px',
  large: '18px',
};

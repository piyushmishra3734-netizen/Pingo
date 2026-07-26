/**
 * Every preference in PINGO, in one shape.
 *
 * ## Where these live, and why it is not the database
 *
 * All of it is stored on the device. That is the right home for most of it —
 * theme, font size, which camera opens first — and it is an *honest* home for
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

import type { AppearanceSettings } from './settings.js';
import { DEFAULT_APPEARANCE } from './settings.js';

export type Audience = 'everyone' | 'friends' | 'nobody';
export type AddAudience = 'everyone' | 'friends-of-friends' | 'nobody';
export type FontSize = 'small' | 'medium' | 'large';
export type AutoDownload = 'always' | 'wifi' | 'never';
export type UploadQuality = 'auto' | 'high' | 'data-saver';
export type CameraFacing = 'front' | 'back';

export interface NotificationPreferences {
  messages: boolean;
  groups: boolean;
  calls: boolean;
  communities: boolean;
  streakReminder: boolean;
  friendBirthday: boolean;
  /** Overrides everything above while on. */
  muteAll: boolean;
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
  swipeActions: boolean;
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
  language: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: DEFAULT_APPEARANCE,
  notifications: {
    messages: true,
    groups: true,
    calls: true,
    communities: false,
    streakReminder: true,
    friendBirthday: true,
    muteAll: false,
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
    hdVideo: false,
    cameraOnByDefault: true,
  },
  advanced: {
    developerMode: false,
    experimentalFeatures: false,
    betaFeatures: false,
    debugLogs: false,
  },
  language: 'en',
};

/** The root font sizes behind the Chats → Font Size control. */
export const FONT_SCALE: Record<FontSize, string> = {
  small: '15px',
  medium: '16px',
  large: '18px',
};

/**
 * @pingo/core — domain model, service boundary and React bindings.
 *
 * Contains no styling and no platform assumptions beyond React, so apps/web and
 * a future apps/mobile can share all of it.
 */

// Domain
export type * from './types.js';

// Service boundary — data
export type {
  ChatService,
  ChatEvent,
  ConnectionState,
  OutgoingMessage,
  Unsubscribe,
} from './chat-service.js';
export { MockChatService, type MockChatServiceOptions } from './mock-chat-service.js';

// Service boundary — identity
export type {
  AuthService,
  AuthSession,
  AuthUser,
  AuthMethodKind,
  AuthErrorCode,
  PasswordAuth,
  OAuthAuth,
} from './auth-service.js';
export { AuthError } from './auth-service.js';

// Service boundary — display identity
export type {
  ProfileService,
  Profile,
  ProfileDraft,
  ProfileErrorCode,
  FollowState,
} from './profile-service.js';
export {
  ProfileError,
  normaliseUsername,
  isValidUsername,
  suggestUsernameFromName,
  canShareMedia,
} from './profile-service.js';

// Service boundary — ephemeral posts
export type { StoryService, Story, StoryGroup } from './story-service.js';

// Service boundary — voice and video
export type {
  CallService,
  CallServiceOptions,
  Call,
  CallPeer,
  CallKind,
  CallState,
  CallEvent,
  CallEndReason,
} from './call-service.js';

// Appearance settings and the searchable registry
export type {
  AppearanceSettings,
  ThemeMode,
  AccentName,
  MotionLevel,
  GlassLevel,
  SettingsEntry,
} from './settings.js';
export {
  DEFAULT_APPEARANCE,
  ACCENT_SWATCHES,
  SETTINGS_REGISTRY,
  searchSettings,
} from './settings.js';

export type {
  Preferences,
  NotificationPreferences,
  PrivacyPreferences,
  ChatPreferences,
  CameraPreferences,
  CallPreferences,
  AdvancedPreferences,
  Audience,
  AddAudience,
  FontSize,
  AutoDownload,
  UploadQuality,
  CameraFacing,
} from './preferences.js';
export { DEFAULT_PREFERENCES, FONT_SCALE } from './preferences.js';

// Stickers: packs are data, loaded at runtime
export type {
  Sticker,
  StickerPack,
  StickerPackSource,
  StickerPackAttribution,
  StickerCategory,
} from './stickers.js';
export { STICKER_CATEGORIES, isValidPack, searchStickers } from './stickers.js';

// Camera: filters, vision and the engine contract
export type {
  CameraEngine,
  CameraEngineOptions,
  FilterDefinition,
  FilterInstance,
  FilterCategory,
  FilterParam,
  Attribution,
  VisionCapability,
  VisionFrame,
  VisionTaskDefinition,
  EffectDefinition,
  Landmark,
} from './camera.js';

// Password, email and phone rules (product decisions, not styling)
export {
  assessPassword,
  isStructurallyValidEmail,
  isStructurallyValidPhone,
  normalisePhoneDigits,
  MIN_PASSWORD_LENGTH,
  type PasswordAssessment,
  type PasswordRequirement,
  type PasswordStrength,
} from './password-policy.js';

// Formatting (product rules, not styling)
export {
  formatTime,
  formatEventTime,
  formatConversationTimestamp,
  formatDayDivider,
  formatDuration,
  formatFileSize,
  formatPresence,
  formatTypingLabel,
  messagePreview,
  groupMessages,
} from './format.js';

// React bindings
export { AuthProvider, useAuth, type AuthStatus } from './react/auth-provider.js';
export { ProfileProvider, useProfile } from './react/profile-provider.js';
export { ChatProvider, useChat } from './react/chat-provider.js';
export { useMessages } from './react/use-messages.js';
export {
  useConversationFilter,
  conversationFilters,
  conversationFilterLabels,
  matchesFilter,
} from './react/use-conversation-filter.js';

// Seed data, exported for the styleguide and for tests.
export * as seed from './seed.js';

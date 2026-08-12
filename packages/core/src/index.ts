/**
 * @pingo/core - domain model, service boundary and React bindings.
 *
 * Contains no styling and no platform assumptions beyond React, so apps/web and
 * a future apps/mobile can share all of it.
 */

// Domain
export type * from './types.js';

// Service boundary - data
export type {
  ChatService,
  StartupSnapshot,
  ChatActivity,
  ChatEvent,
  ConnectionState,
  MessageReceipt,
  OutgoingMessage,
  VideoEdit,
  VideoOverlayItem,
  VideoOverlayStroke,
  ReadReceipt,
  Unsubscribe,
} from './chat-service.js';
export { MockChatService, type MockChatServiceOptions } from './mock-chat-service.js';

// Service boundary - identity
export type {
  AuthService,
  SavedAccountSummary,
  AuthSession,
  AuthUser,
  AuthMethodKind,
  AuthErrorCode,
  PasswordAuth,
  OAuthAuth,
  UsernameAuth,
} from './auth-service.js';
export { AuthError } from './auth-service.js';

// Service boundary - display identity
export type {
  ProfileService,
  Profile,
  ProfileDraft,
  ProfileErrorCode,
  FollowState,
  Post,
  PostDraft,
  PostComment,
  ProfileStats,
  PublicJourney,
  PrivacySettings,
  PublicJourneyDraft,
  SharedHistory,
  ChatMediaItem,
  ReportReason,
  ReportInput,
} from './profile-service.js';
export {
  OPEN_PRIVACY,
  ProfileError,
  normaliseUsername,
  isValidUsername,
  suggestUsernameFromName,
  canShareMedia,
} from './profile-service.js';

// Service boundary - ephemeral posts
export type {
  StoryService,
  Story,
  StoryGroup,
  StoryDraft,
  StoryAudioTrack,
  StoryAudioDraft,
  StoryKind,
  StoryAudience,
  StoryViewer,
  StoryInsights,
  StoryReaction,
} from './story-service.js';
export { STORY_REACTIONS, STORY_PHOTO_MS, STORY_AUDIENCES } from './story-service.js';

// Service boundary - voice and video
export type {
  CallService,
  CallServiceOptions,
  Call,
  CallParticipant,
  CallPeer,
  CallKind,
  CallState,
  CallEvent,
  CallEndReason,
  CallQuality,
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
export { sortConversationsForList } from './sort-conversations.js';

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

// Links inside a message: a product rule about what a message means.
export type { MessageSegment, TextSegment, LinkSegment } from './linkify.js';
export { linkify, hasLink } from './linkify.js';

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
  PIN_LIMIT,
  MUTE_DURATIONS,
  formatMuteUntil,
  conversationFilters,
  conversationFilterLabels,
  matchesFilter,
} from './react/use-conversation-filter.js';

// Video links: detection, normalisation, and the per-platform adapters.
export {
  detectVideoLink,
  enrichVideoPreview,
  fileNameFrom,
  findLinks,
  type VideoPreview,
  type VideoProvider,
  type VideoPlatform,
} from './video/index.js';

// Seed data, exported for the styleguide and for tests.
export * as seed from './seed.js';

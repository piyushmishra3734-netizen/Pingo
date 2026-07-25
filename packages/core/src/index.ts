/**
 * @pingo/core — domain model, service boundary and React bindings.
 *
 * Contains no styling and no platform assumptions beyond React, so apps/web and
 * a future apps/mobile can share all of it.
 */

// Domain
export type * from './types.js';

// Service boundary
export type {
  ChatService,
  ChatEvent,
  ConnectionState,
  OutgoingMessage,
  Unsubscribe,
} from './chat-service.js';
export { MockChatService } from './mock-chat-service.js';

// Formatting (product rules, not styling)
export {
  formatTime,
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

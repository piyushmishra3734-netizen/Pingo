/**
 * PINGO AI's own thread is part of the app, not somebody's chat: it cannot be
 * archived (a side chat with it still can). The database refuses too, so an
 * older build offering the swipe changes nothing.
 */
export const isInbuiltAi = (conversation: { kind: string; aiSide?: boolean | undefined }): boolean =>
  conversation.kind === 'ai' && !conversation.aiSide;

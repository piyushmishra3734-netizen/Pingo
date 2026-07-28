import { useChat } from '@pingo/core';
import { EmptyState, cn } from '@pingo/ui';
import { Navigate, useParams } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { InstallBanner } from '../features/install/InstallBanner.js';
import { ChatThread } from '../features/chat/ChatThread.js';
import { ConversationList } from '../features/conversations/ConversationList.js';
import { useIsDesktop } from '../hooks/useMediaQuery.js';

/**
 * The chats route, at both layouts.
 *
 * Phone: one pane. `/chats` is the list, `/chats/:id` is the thread. Back
 * navigation is the browser's, so the hardware back button behaves correctly.
 *
 * Desktop: two panes. The list is always visible and the thread fills the rest,
 * with a placeholder when nothing is selected. The URL means the same thing in
 * both cases, so a link shared from a phone opens correctly on a desktop.
 *
 * One component rather than two routes because the *state* is identical — only
 * the arrangement differs. Splitting them would mean keeping two versions of the
 * same behaviour in sync.
 */
export function ChatsScreen() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { conversations, ready } = useChat();
  const isDesktop = useIsDesktop();

  const conversation = conversationId
    ? conversations.find((c) => c.id === conversationId)
    : undefined;

  // A stale or mistyped id should land the user somewhere useful, not on an error.
  if (ready && conversationId && !conversation) {
    return <Navigate to="/chats" replace />;
  }

  if (!isDesktop) {
    return conversation ? (
      <ChatThread conversation={conversation} showBack />
    ) : (
      <>
        <ConversationList />
        {/*
          Home only, and only with no thread open. An offer to install has no
          business over a conversation somebody is reading.
        */}
        <InstallBanner />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <InstallBanner />
      <aside
        className={cn(
          'hidden h-full shrink-0 border-r border-line bg-page lg:block',
          'w-[22rem] xl:w-[25rem]',
        )}
      >
        <ConversationList activeConversationId={conversation?.id} />
      </aside>

      <section className="min-w-0 flex-1">
        {conversation ? (
          <ChatThread conversation={conversation} />
        ) : (
          <div className="grid h-full place-items-center bg-page">
            {/*
              The placeholder is a brand moment, not an error. It uses the
              monogram at low opacity so an idle desktop window still looks
              considered.
            */}
            <div className="flex flex-col items-center">
              {/*
                The official icon, faded rather than a recoloured redrawing of
                it. A muted brand moment does not need a different logo — it
                needs the same one, quieter.
              */}
              <AppLogo size={64} alt="" className="opacity-45" />
              <EmptyState
                title="Pick a conversation"
                description="Choose someone from the list to start reading."
                className="pt-6"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

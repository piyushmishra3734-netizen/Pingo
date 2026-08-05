import { useChat, useProfile } from '@pingo/core';
import { EmptyState, cn } from '@pingo/ui';
import { Navigate, useParams } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { InstallBanner } from '../features/install/InstallBanner.js';
import { BackupFoundCard, BackupPrompt, BackupReminderCard } from '../features/backup/BackupSurfaces.js';
import { useBackupUx } from '../features/backup/useBackupUx.js';
import { ChatThread } from '../features/chat/ChatThread.js';
import { ConversationList } from '../features/conversations/ConversationList.js';
import { DailyJourneyCard } from '../features/journey/DailyJourneyCard.js';
import { DUMMY_DAILY_NOTE, DUMMY_MISSIONS } from '../features/journey/dummy-journey.js';
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
 * One component rather than two routes because the *state* is identical - only
 * the arrangement differs. Splitting them would mean keeping two versions of the
 * same behaviour in sync.
 */
export function ChatsScreen() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { profile } = useProfile();
  const { conversations, ready } = useChat();
  const isDesktop = useIsDesktop();
  /*
   * Called before the early returns below, because a hook that runs only on
   * some renders is a hook that crashes on the others.
   */
  const backupUx = useBackupUx();

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
        {/*
          Above the list, because a backup that needs attention is about the
          list rather than about any one conversation.
        */}
        {/*
          Inside the list, not above it. As siblings these sat over the header —
          on a phone that put them against the status bar, outside PINGO's own
          chrome, which is what made them read as a browser notification nobody
          could get rid of.
        */}
        <ConversationList
          banner={
            <>
              <BackupFoundCard ux={backupUx} />
              <BackupReminderCard ux={backupUx} />
            </>
          }
        />
        {/*
          Home only, and only with no thread open. An offer to install has no
          business over a conversation somebody is reading.
        */}
        <InstallBanner />
      {/*
        Once a day, on the screen the app opens to. Not a modal: nothing behind
        it is disabled and it leaves on its own after five seconds.
      */}
      <DailyJourneyCard
        missions={DUMMY_MISSIONS}
        note={DUMMY_DAILY_NOTE}
        {...(profile?.displayName ? { name: profile.displayName.split(" ")[0] } : {})}
      />
        <BackupPrompt ux={backupUx} />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <InstallBanner />
      <BackupPrompt ux={backupUx} />
      <aside
        className={cn(
          'hidden h-full shrink-0 border-r border-line bg-page lg:block',
          'w-[22rem] xl:w-[25rem]',
        )}
      >
        <ConversationList
          {...(conversation?.id ? { activeConversationId: conversation.id } : {})}
          banner={
            <>
              <BackupFoundCard ux={backupUx} />
              <BackupReminderCard ux={backupUx} />
            </>
          }
        />
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
                it. A muted brand moment does not need a different logo - it
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

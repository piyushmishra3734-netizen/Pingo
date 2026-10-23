import { PinGate } from '../features/lock/PinGate.js';
import { loadLocks, touchSession, useLockedIds, useUnlocked } from '../features/lock/lock-store.js';
import { useChat, useProfile } from '@pingo/core';
import { EmptyState, cn } from '@pingo/ui';
import { Suspense, useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { useAiConversation } from '../features/ai/ai-data.js';
import { InstallBanner } from '../features/install/InstallBanner.js';
import { ConversationList } from '../features/conversations/ConversationList.js';
import { useT } from '../features/i18n/useT.js';
import { DailyJourneyCard } from '../features/journey/DailyJourneyCard.js';
import { useDailyMissions } from '../features/journey/daily-missions.js';
import { DUMMY_DAILY_NOTE } from '../features/journey/dummy-journey.js';
import { useIsDesktop } from '../hooks/useMediaQuery.js';
import { lazyNamed } from '../lib/lazy-named.js';

/*
 * The thread arrives after the list. Launching opens the list, and on a slow
 * link every kilobyte ahead of it is time spent looking at the splash - so the
 * thread (bubbles, composer, menus: about a quarter of the old entry chunk)
 * is fetched once the list is up rather than before it. By the time a finger
 * lands on a row it is almost always already here.
 */
const ChatThread = lazyNamed(() => import('../features/chat/ChatThread.js'), 'ChatThread');

/** What shows for the moment a thread's code is still on its way. */
function ThreadPending() {
  return <div className="h-full bg-page" aria-busy="true" />;
}

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
  const t = useT();
  const { conversationId } = useParams<{ conversationId: string }>();
  const { profile } = useProfile();
  const { conversations, aiSideChats, ready } = useChat();
  const isDesktop = useIsDesktop();
  const missions = useDailyMissions();
  /*
   * Fetch the thread once the list has settled - on any link, since opening a
   * chat is the one thing nearly every launch leads to. Not `whenIdle`, which
   * holds back on a poor connection: that is exactly where waiting at the tap
   * would hurt most.
   */
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => void ChatThread.preload(), 1200);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const listed = conversationId
    ? (conversations.find((c) => c.id === conversationId) ??
      aiSideChats.find((c) => c.id === conversationId))
    : undefined;
  /*
   * A PINGO AI side chat is never in the list, so one the provider has not
   * met yet (a deep link, a notification, Recents after a reload) is read by
   * id before anyone decides the id is stale.
   */
  const side = useAiConversation(ready && conversationId && !listed ? conversationId : undefined);
  const conversation = listed ?? side.conversation;
  /*
   * A locked chat is behind the PIN wherever it is reached from: the locked
   * list, a notification, a pasted link. Locked and not unlocked: no thread.
   */
  const lockedIds = useLockedIds();
  const unlocked = useUnlocked();
  const navigate = useNavigate();
  useEffect(() => void loadLocks(), []);
  const lockedOut = Boolean(conversation && lockedIds.has(conversation.id) && !unlocked);
  useEffect(() => {
    if (!conversation || !lockedIds.has(conversation.id) || !unlocked) return;
    touchSession();
    const id = setInterval(touchSession, 30_000);
    return () => clearInterval(id);
  }, [conversation, lockedIds, unlocked]);

  // A stale or mistyped id should land the user somewhere useful, not on an error.
  if (ready && conversationId && !conversation && !side.pending) {
    return <Navigate to="/chats" replace />;
  }

  // Reading a side chat by id: hold the thread's place rather than flash the list.
  if (!isDesktop && conversationId && !conversation && side.pending) return <ThreadPending />;

  if (!isDesktop) {
    return conversation ? (
      lockedOut ? (
        <PinGate onSuccess={() => undefined} onCancel={() => navigate('/chats', { replace: true })} />
      ) : (
        <Suspense fallback={<ThreadPending />}>
          <ChatThread conversation={conversation} showBack />
        </Suspense>
      )
    ) : (
      <>
        <ConversationList />
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
        missions={missions}
        note={DUMMY_DAILY_NOTE}
        {...(profile?.displayName ? { name: profile.displayName.split(" ")[0] } : {})}
      />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Not over an open conversation: on a laptop it sat on top of the composer. */}
      {!conversationId && <InstallBanner />}
      <aside
        className={cn(
          'hidden h-full shrink-0 border-r border-line bg-page lg:block',
          'w-[22rem] xl:w-[25rem]',
        )}
      >
        <ConversationList
          {...(conversation?.id ? { activeConversationId: conversation.id } : {})}
        />
      </aside>

      <section className="min-w-0 flex-1">
        {conversation ? (
          lockedOut ? (
            <PinGate onSuccess={() => undefined} onCancel={() => navigate('/chats', { replace: true })} />
          ) : (
            <Suspense fallback={<ThreadPending />}>
              <ChatThread conversation={conversation} />
            </Suspense>
          )
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
                title={t('chats.pick')}
                description={t('chats.pickHint')}
                className="pt-6"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

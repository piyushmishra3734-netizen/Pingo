import { useChat, useProfile } from '@pingo/core';
import { Gamepad2 } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Sheet } from '../components/Sheet.js';
import { ARCADE_ORIGIN, ARCADE_URL, arcadeInviteBody, inviteFromSearch, type ArcadeInvite } from '../features/arcade/arcade-link.js';
import { PingRecipients, PingSendButton } from '../features/camera/PingRecipients.js';

/**
 * PINGO Arcade, inside PINGO.
 *
 * The arcade is its own site, so it runs in a full-screen frame. It is told
 * who you are (your PINGO name) and, when you arrive from a Join card, which
 * room to walk into. Walking in on your own makes a fresh room.
 *
 * Leaving is "Leave arcade" in the arcade's own menu, which posts back here.
 * The room it opens is written into this page's address, so a reload (PINGO
 * refreshing itself, the phone reclaiming memory) walks back into the same
 * room instead of a new one.
 *
 * The arcade is a landscape game. Upright, PINGO first asks the phone to turn
 * (full screen + orientation lock, where the WebView allows it); where it
 * cannot, the frame is drawn turned a quarter, so the game is landscape either
 * way and the player just turns the phone.
 *
 * Inviting happens here, not in the frame: the arcade posts the room it is in,
 * and PINGO shows its own friend picker - the one sharing and Pings use - then
 * sends each chosen chat an invite message, which the bubble draws as a Join
 * card. No link to copy, nothing to paste.
 */
const portraitQuery = () => window.matchMedia('(orientation: portrait)');
const subscribePortrait = (onChange: () => void) => {
  const query = portraitQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function ArcadeScreen() {
  const portrait = useSyncExternalStore(subscribePortrait, () => portraitQuery().matches);
  const navigate = useNavigate();
  const { search } = useLocation();
  const { profile } = useProfile();
  const { service } = useChat();

  const [invite, setInvite] = useState<ArcadeInvite>();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string>();

  // Arrived from a notification or a card there may be nothing to go back to.
  const leave = () => (window.history.length > 1 ? navigate(-1) : navigate('/chats', { replace: true }));

  // Fixed on first render: a new src would reload the game under the player.
  const src = useMemo(() => {
    const url = new URL(ARCADE_URL);
    url.searchParams.set('embed', 'pingo');
    const name = profile?.displayName?.split(' ')[0];
    if (name) url.searchParams.set('as', name);
    const joining = inviteFromSearch(search);
    if (joining) {
      url.searchParams.set('room', joining.room);
      url.searchParams.set('seat', joining.seat);
      if (joining.from) url.searchParams.set('from', joining.from);
    }
    return url.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Try the real thing first: full screen, locked to landscape. Browsers and
  // WebViews that refuse leave `portrait` true, and the frame turns instead.
  useEffect(() => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    void document.documentElement
      .requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => orientation.lock?.('landscape'))
      .catch(() => undefined);
    return () => {
      orientation.unlock?.();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ARCADE_ORIGIN) return;
      const data = event.data as { type?: string; room?: string; seat?: string; from?: string } | null;
      if (data?.type === 'pingo-arcade:leave') {
        leave();
        return;
      }
      if (data?.type === 'pingo-arcade:room') {
        const room = inviteFromSearch(`?${new URLSearchParams({ room: data.room ?? '', seat: data.seat ?? 'A' })}`);
        if (room) navigate(`/arcade?${new URLSearchParams({ room: room.room, seat: room.seat })}`, { replace: true });
        return;
      }
      if (data?.type !== 'pingo-arcade:invite') return;
      const next = inviteFromSearch(`?${new URLSearchParams({ room: data.room ?? '', seat: data.seat ?? 'B', from: data.from ?? '' })}`);
      if (!next) return;
      setInvite(next);
      setSelected(new Set());
      setError(undefined);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (conversationId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };

  const send = async () => {
    if (!invite || selected.size === 0 || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const body = arcadeInviteBody(invite);
      await Promise.all([...selected].map((conversationId) => service.sendMessage({ conversationId, body })));
      setSent(selected.size);
      setInvite(undefined);
      setTimeout(() => setSent(0), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black">
      <iframe
        title="PINGO Arcade"
        src={src}
        allow="microphone; autoplay; fullscreen; clipboard-write"
        className="border-0"
        style={
          portrait
            ? { position: 'absolute', top: 0, left: '100vw', width: '100dvh', height: '100vw', transform: 'rotate(90deg)', transformOrigin: 'top left' }
            : { width: '100%', height: '100%' }
        }
      />

      {sent > 0 && (
        <div
          role="status"
          className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-caption font-semibold text-white backdrop-blur"
        >
          <Gamepad2 size={16} className="mr-1.5 inline align-[-3px]" aria-hidden />
          Invite sent to {sent === 1 ? '1 chat' : `${sent} chats`} - they'll get a Join button
        </div>
      )}

      {invite && (
        <Sheet
          title="Invite to PINGO Arcade"
          description="They get a Join card in chat and walk straight into your room."
          onClose={() => setInvite(undefined)}
          elevated
        >
          {error ? (
            <p role="alert" className="px-1 pb-2 text-caption text-danger">
              {error}
            </p>
          ) : null}
          <div className="max-h-[50vh] min-h-0 overflow-y-auto">
            <PingRecipients selected={selected} onToggle={toggle} anyConversation />
          </div>
          <div className="pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <PingSendButton count={selected.size} busy={busy} onSend={() => void send()} />
          </div>
        </Sheet>
      )}
    </div>
  );
}

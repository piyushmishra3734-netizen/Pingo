import { useChat, type FilterInstance } from '@pingo/core';
import { Avatar, CameraFlipIcon, CameraIcon, CheckIcon, PingoDot, cn } from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FILTERS } from '../features/camera/filters/registry.js';
import { SnapEditor } from '../features/camera/SnapEditor.js';
import { useCamera } from '../features/camera/useCamera.js';
import { useStories } from '../features/stories/StoryContext.js';

/**
 * Camera — shoot, filter, edit, then send or save.
 *
 * Three stages, and the screen is only ever in one of them:
 *
 *   live   filtered preview and the shutter
 *   edit   draw and text on the captured frame
 *   send   who gets it, or save it to the gallery
 *
 * ## The filter is in the photo, not on the screen
 *
 * The preview is the WebGL canvas that `useCamera` renders the filter chain
 * into, and the capture reads back that same canvas. There is no second path
 * where an unfiltered frame could escape — which is what went wrong in the
 * first version of this screen, where the registry existed and nothing used it.
 *
 * ## Falling back without dead-ending
 *
 * `getUserMedia` needs a permission that can be refused, hardware that may not
 * exist, and a secure context. All three land on the same fallback: a file
 * picker, which opens the camera on a phone and the gallery everywhere else.
 * The rest of the flow — edit, send, save — is identical either way, because it
 * only ever operates on a blob.
 */

type Stage = 'live' | 'edit' | 'send';

export function CameraScreen() {
  const navigate = useNavigate();
  const { service: chat, conversations, users, currentUser } = useChat();
  const { service: stories, refresh } = useStories();

  const fileRef = useRef<HTMLInputElement>(null);

  const [filterId, setFilterId] = useState('none');
  const [stage, setStage] = useState<Stage>('live');
  const [shot, setShot] = useState<{ blob: Blob; url: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  // A single-entry chain. The pipeline takes a list because filters compose;
  // the UI offers one at a time because a carousel of combinations is nobody's
  // idea of a good camera.
  const chain = useMemo<FilterInstance[]>(
    () => [{ filterId, intensity: 1 }],
    [filterId],
  );

  const camera = useCamera(chain);

  // Blob URLs outlive the document unless revoked.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  const accept = (blob: Blob) => {
    setShot((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return { blob, url: URL.createObjectURL(blob) };
    });
    setStage('edit');
  };

  const reset = () => {
    setShot(undefined);
    setSentTo(new Set());
    setError(undefined);
    setStage('live');
  };

  // ---- actions ------------------------------------------------------------

  const saveToGallery = () => {
    if (!shot) return;
    /*
     * A download, because the web has no gallery API. On Android and iOS this
     * lands in Downloads/Photos exactly as a saved image should; on desktop it
     * is a file. Naming it by timestamp keeps a burst of snaps from
     * overwriting each other.
     */
    const link = document.createElement('a');
    link.href = shot.url;
    link.download = `pingo-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    link.click();
  };

  const sendTo = async (conversationId: string) => {
    if (!shot || sentTo.has(conversationId)) return;
    setBusy(true);
    setError(undefined);
    try {
      await chat.sendMessage({ conversationId, body: 'Snap', snap: { image: shot.blob } });
      // Marked rather than navigated away from, so one snap can go to several
      // people in one pass — which is the whole point of this screen.
      setSentTo((all) => new Set(all).add(conversationId));
    } catch {
      setError("That didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const postStory = async () => {
    if (!shot) return;
    setBusy(true);
    setError(undefined);
    try {
      await stories.post(shot.blob);
      await refresh();
      navigate('/chats', { replace: true });
    } catch {
      setError("That didn't post. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // ---- stages -------------------------------------------------------------

  if (stage === 'edit' && shot) {
    return (
      <SnapEditor
        src={shot.url}
        busy={busy}
        onCancel={reset}
        onDone={(blob) => {
          setShot((previous) => {
            if (previous) URL.revokeObjectURL(previous.url);
            return { blob, url: URL.createObjectURL(blob) };
          });
          setStage('send');
        }}
      />
    );
  }

  if (stage === 'send' && shot) {
    const direct = conversations.filter((conversation) => conversation.kind === 'direct');

    return (
      <div className="flex h-full flex-col bg-ink">
        <div className="relative min-h-0 flex-[2] overflow-hidden">
          <img src={shot.url} alt="Your snap" className="absolute inset-0 size-full object-contain" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-page px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && (
            <p role="alert" className="mb-3 text-center text-caption text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <SendAction onClick={() => void postStory()} disabled={busy}>
              My Story
            </SendAction>
            <SendAction onClick={saveToGallery}>Save</SendAction>
            <SendAction onClick={reset} disabled={busy}>
              Retake
            </SendAction>
          </div>

          <p className="mt-5 mb-2 text-caption text-text-secondary">Send to</p>

          {direct.length === 0 ? (
            <p className="py-6 text-center text-caption text-text-tertiary">
              No chats yet. Your snap can still go to your story.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {direct.map((conversation) => {
                const partner = users.find(
                  (user) =>
                    conversation.participantIds.includes(user.id) && user.id !== currentUser?.id,
                );
                const sent = sentTo.has(conversation.id);

                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => void sendTo(conversation.id)}
                      disabled={busy || sent}
                      className={cn(
                        'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5',
                        'transition-colors duration-instant hover:bg-hover',
                        'disabled:opacity-100',
                      )}
                    >
                      <Avatar
                        name={conversation.title}
                        id={partner?.id ?? conversation.id}
                        src={partner?.avatarUrl}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-left text-body text-ink">
                        {conversation.title}
                      </span>
                      {sent ? (
                        <span className="flex items-center gap-1 text-caption text-brand">
                          <CheckIcon size={15} /> Sent
                        </span>
                      ) : (
                        <span className="text-caption text-text-tertiary">Send</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ---- live ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-ink">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/*
          Mirrored for the front camera only. A preview that moves the opposite
          way to your hand is unusable; a rear camera mirrored is just wrong.
          The capture is never mirrored, so text in shot reads the right way.
        */}
        <canvas
          ref={camera.canvasRef}
          className={cn(
            'absolute inset-0 size-full object-cover',
            camera.facing === 'user' && '-scale-x-100',
            camera.status !== 'ready' && 'opacity-0',
          )}
        />

        {camera.status === 'starting' && (
          <div className="absolute inset-0 grid place-items-center">
            <PingoDot state="loading" size={8} label="Starting camera" />
          </div>
        )}

        {camera.status === 'unavailable' && (
          <div className="absolute inset-0 grid place-items-center px-8 text-center">
            <div>
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white/10 text-white">
                <CameraIcon size={28} />
              </span>
              <p className="mt-6 text-body text-white">No camera here.</p>
              <p className="mt-2 text-caption text-white/60">
                Pick a photo instead — everything after this works the same.
              </p>
            </div>
          </div>
        )}

        {camera.status === 'ready' && (
          <button
            type="button"
            aria-label="Switch camera"
            onClick={() => void camera.flip()}
            className="focus-ring absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-black/40 text-white"
          >
            <CameraFlipIcon size={20} />
          </button>
        )}
      </div>

      {/* ---- filters ----------------------------------------------------- */}
      {camera.status === 'ready' && (
        <div className="shrink-0 overflow-x-auto px-4 py-3">
          <div className="flex gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={filterId === filter.id}
                onClick={() => setFilterId(filter.id)}
                className={cn(
                  'focus-ring shrink-0 rounded-full px-4 py-2 text-caption font-medium',
                  'transition-colors duration-instant',
                  filterId === filter.id ? 'bg-white text-ink' : 'bg-white/12 text-white',
                )}
              >
                {filter.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 px-6 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center gap-8">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="focus-ring rounded-full px-3 py-2 text-body text-white hover:bg-white/10"
          >
            Gallery
          </button>

          {/* The shutter: a ring around a disc, the shape every camera uses. */}
          <button
            type="button"
            aria-label="Take snap"
            disabled={camera.status !== 'ready'}
            onClick={() => {
              void camera.capture().then((blob) => {
                if (blob) accept(blob);
              });
            }}
            className={cn(
              'grid size-18 place-items-center rounded-full',
              'focus-ring ring-4 ring-white',
              'transition-transform duration-instant ease-standard active:scale-[0.94]',
              'disabled:opacity-40',
            )}
          >
            <span className="size-14 rounded-full bg-white" />
          </button>

          <button
            type="button"
            onClick={() => navigate('/chats')}
            className="focus-ring rounded-full px-3 py-2 text-body text-white hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) accept(file);
          }}
        />
      </div>
    </div>
  );
}

function SendAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'focus-ring flex-1 rounded-full bg-surface py-2.5 text-caption font-medium text-ink',
        'shadow-sm transition-transform duration-instant active:scale-[0.98]',
        'disabled:opacity-50',
      )}
    >
      {children}
    </button>
  );
}

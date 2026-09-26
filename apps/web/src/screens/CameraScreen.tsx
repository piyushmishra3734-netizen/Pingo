import { useChat, type FilterInstance } from '@pingo/core';
import { CameraFlipIcon, CameraIcon, CheckIcon, GridIcon, PingoDot, cn } from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { filterStill } from '../features/camera/filterStill.js';
import { FILTERS } from '../features/camera/filters/registry.js';
import { SnapEditor } from '../features/camera/SnapEditor.js';
import { SnapCamera, type SnapShot } from '../features/camera/snap/SnapCamera.js';
import { SnapShotEditor } from '../features/camera/snap/SnapShotEditor.js';
import { useCamera } from '../features/camera/useCamera.js';
import { PingRecipients, PingSendButton } from '../features/camera/PingRecipients.js';
import { PingViewLimit, type PingViews } from '../features/camera/PingViewLimit.js';
import { saveImage } from '../features/native/save-image.js';
import { useBackStep } from '../features/navigation/useBackStep.js';
import { useT } from '../features/i18n/useT.js';
import { usePreferences } from '../features/settings/SettingsContext.js';
import { useStories } from '../features/stories/StoryContext.js';

/** Opened from a chat attach menu with this thread already chosen. */
type CameraLocationState = { conversationId?: string };

/**
 * Camera - shoot, filter, edit, then send a Ping or add to your story.
 *
 * Four stages, and the screen is only ever in one:
 *
 *   live    filtered preview, hardware controls, shutter
 *   filter  pick a look - for *every* image, however it arrived
 *   edit    draw and text
 *   send    how many views, who gets it, or add it to your story
 *
 * ## Why filtering is its own stage
 *
 * It used to happen only in the live preview, which meant a device with no
 * camera showed no filters at all and a photo chosen from the gallery reached
 * the editor untouched. The filter belonged to the camera rather than to the
 * Ping. Now the preview renders the chain *and* the chosen filter is applied to
 * the still, so both paths get the same result and neither depends on hardware.
 *
 * ## Hardware controls are offered only where they exist
 *
 * Zoom, torch, focus and exposure are camera capabilities, not app features.
 * Support is genuinely uneven across browsers and devices, so each control is
 * hidden unless this specific camera reports it - a slider that silently does
 * nothing is worse than no slider.
 */

type Stage = 'gate' | 'live' | 'filter' | 'edit' | 'send';

const TIMERS = [0, 3, 5, 10] as const;

export function CameraScreen() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { service: chat } = useChat();
  const { service: stories, refresh } = useStories();
  const { preferences } = usePreferences();

  /*
   * When the attach menu opens the camera from a thread, that conversation is
   * already the answer to "who". Pre-select it and, after send, go back there
   * instead of dumping the user on a blank camera.
   */
  const lockedChatId = (location.state as CameraLocationState | null)?.conversationId;

  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const [filterId, setFilterId] = useState('none');
  const [stage, setStage] = useState<Stage>('gate');
  const [original, setOriginal] = useState<Blob>();
  const [shot, setShot] = useState<{ blob: Blob; url: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /** Chosen together and committed once - see `PingRecipients`. */
  const [recipients, setRecipients] = useState<Set<string>>(() =>
    lockedChatId ? new Set([lockedChatId]) : new Set(),
  );
  /** Two is the default: long enough to look twice, short enough to be a Ping. */
  const [views, setViews] = useState<PingViews>(2);
  /** Drives the confirmation, and the beat before returning to the camera. */
  const [sentCount, setSentCount] = useState(0);

  /** What the Snap camera took, on its way to Save, My story or Send to. */
  const [snapShot, setSnapShot] = useState<SnapShot>();
  useBackStep(!!snapShot, () => setSnapShot(undefined));
  const [grid, setGrid] = useState(false);
  const [timer, setTimer] = useState<(typeof TIMERS)[number]>(0);
  const [countdown, setCountdown] = useState<number>();
  const [flash, setFlash] = useState(false);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number } | undefined>();

  const chain = useMemo<FilterInstance[]>(() => [{ filterId, intensity: 1 }], [filterId]);

  // Nothing is opened until the gate is passed, so arriving here by a mis-tap
  // never triggers the permission prompt.
  // The Snap camera below owns the camera now; this pipeline stays closed.
  const camera = useCamera(
    chain,
    false,
    // Settings → Camera & Pings → Default Camera. 'front' is the selfie lens.
    preferences.camera.defaultCamera === 'back' ? 'environment' : 'user',
  );

  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  // Keep the locked chat selected if reset clears the set.
  useEffect(() => {
    if (!lockedChatId) return;
    setRecipients((previous) => {
      if (previous.has(lockedChatId)) return previous;
      const next = new Set(previous);
      next.add(lockedChatId);
      return next;
    });
  }, [lockedChatId]);

  const show = (blob: Blob) => {
    setShot((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return { blob, url: URL.createObjectURL(blob) };
    });
  };

  const reset = () => {
    setShot(undefined);
    setOriginal(undefined);
    setRecipients(lockedChatId ? new Set([lockedChatId]) : new Set());
    setViews(2);
    setError(undefined);
    setFilterId('none');
    setStage('live');
  };

  /*
   * The live preview has already baked its filter in, so a camera shot arrives
   * filtered and a gallery photo does not. Keeping the *original* means the
   * filter stage can re-render from source each time rather than stacking one
   * filter on top of another as the user browses.
   */
  const beginFilter = (blob: Blob, alreadyFiltered: boolean) => {
    setOriginal(blob);
    show(blob);
    if (alreadyFiltered) setFilterId('none');
    setStage('filter');
  };

  const chooseFilter = async (id: string) => {
    setFilterId(id);
    if (!original) return;
    setBusy(true);
    try {
      show(id === 'none' ? original : await filterStill(original, [{ filterId: id, intensity: 1 }]));
    } finally {
      setBusy(false);
    }
  };

  const shoot = () => {
    const take = () => {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 160);
      void camera.capture().then((blob) => {
        if (blob) beginFilter(blob, true);
      });
    };

    if (timer === 0) {
      take();
      return;
    }

    let left: number = timer;
    setCountdown(left);
    const tick = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(tick);
        setCountdown(undefined);
        take();
      } else {
        setCountdown(left);
      }
    }, 1000);
  };

  // ---- send ---------------------------------------------------------------

  /*
   * A download in a browser, MediaStore in the app.
   *
   * This was the anchor alone, and inside an Android WebView an anchor with
   * `download` does nothing whatsoever - no file, no error, no notification.
   * Save appeared to work and produced nothing, which is the worst shape a bug
   * can take, because the person believes they have the photo.
   */
  const saveToGallery = () => {
    if (!shot) return;
    void saveImage(shot.blob, `pingo-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
  };

  /**
   * Sends the Ping to everyone chosen, then goes back to the camera.
   *
   * One commit rather than one per tap: sending is a single decision about a
   * single picture, and the return is the point. A Ping flow that leaves you
   * looking at a chat has quietly become the normal chat flow.
   */
  const sendPing = async () => {
    if (!shot || recipients.size === 0 || busy) return;
    if (!shot.blob || shot.blob.size === 0) {
      setError('No image to send. Retake the Ping.');
      return;
    }
    setBusy(true);
    setError(undefined);

    try {
      await Promise.all(
        [...recipients].map((conversationId) =>
          chat.sendMessage({
            conversationId,
            body: 'Ping',
            ping: { image: shot.blob, views },
          }),
        ),
      );

      /*
       * A held beat before the camera comes back.
       *
       * Long enough to see that it went, short enough that nobody is waiting.
       * Returning instantly makes a send feel like it may not have happened;
       * a dialog makes it feel like paperwork.
       *
       * `busy` used to stay true forever after a successful send - `reset()`
       * never cleared it - so the next Ping or story attempt silently no-oped.
       */
      /*
        Settings → Camera & Pings → Save Pings, which nothing read either.
        Saved only after the send succeeds: a copy of a picture that never went
        anywhere is clutter, and the switch says "keep a copy of what you post".
      */
      if (preferences.camera.saveSnaps) saveToGallery();

      setSentCount(recipients.size);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      setSentCount(0);
      // From chat: return to that thread. From the dock: stay on camera.
      if (lockedChatId) {
        navigate(`/chats/${lockedChatId}`, { replace: true });
      } else {
        reset();
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "That didn't send. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const postStory = async () => {
    if (!shot) return;
    if (!shot.blob || shot.blob.size === 0) {
      setError('No image to post. Retake first.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // Friends is the default audience; the creator's own audience step is
      // where a different one is chosen.
      await stories.post({ media: shot.blob, kind: 'photo', audience: 'friends' });
      // A story is something you posted too.
      if (preferences.camera.saveSnaps) saveToGallery();
      await refresh();
      navigate('/chats', { replace: true });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "That didn't post. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  /*
   * Back walks the stages backwards, one at a time.
   *
   * The camera is four screens wearing one route - the gate, the live view, the
   * shot with its filters, the editor, the send sheet - so Back used to leave
   * the camera entirely from wherever you happened to be, throwing away the
   * picture. Each stage past the live view now steps back to the one before it,
   * which is the same thing its own back arrow does.
   */
  useBackStep(stage === 'filter', () => setStage('live'));
  useBackStep(stage === 'edit', () => setStage('filter'));
  useBackStep(stage === 'send', () => setStage('edit'));

  // ---- stages -------------------------------------------------------------

  /*
   * The gate.
   *
   * The camera is the one place in PINGO that takes over the screen and asks
   * the operating system for something. Opening it the instant a tab is tapped
   * makes a mis-tap cost a permission prompt and a lit camera light, so it
   * waits here for a deliberate "yes". Nothing is requested until then.
   */
  /*
   * After the shutter: Instagram's story editor, and Snapchat's Send to.
   *
   * One flow rather than two. The camera is Snap's - Lenses, music, hold to
   * record - and what comes after it is the story editor people already know,
   * whose arrow sends to My story, Close friends or chats. A chat gets a Ping,
   * with its view limit.
   */
  if (snapShot) {
    return (
      <SnapShotEditor
        shot={snapShot}
        {...(lockedChatId ? { lockedChatId } : {})}
        onDone={() => {
          setSnapShot(undefined);
          // From a chat: back to it. From the dock: stay on the camera, as Snapchat does.
          if (lockedChatId) navigate(`/chats/${lockedChatId}`, { replace: true });
        }}
        onPost={async (draft) => {
          await stories.post(draft);
          if (preferences.camera.saveSnaps && snapShot.kind === 'photo') void saveImage(draft.media, 'pingo-story.jpg');
          await refresh();
        }}
      />
    );
  }

  if (stage === 'gate') {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-backdrop px-8">
        <div className="animate-fade-in flex flex-col items-center text-center">
          <span className="grid size-20 place-items-center rounded-3xl bg-white/10 text-white">
            <CameraIcon size={34} />
          </span>

          <h1 className="mt-7 text-h1 text-white">{t('camera.openAsk')}</h1>
          <p className="mt-2 max-w-xs text-body text-white/60">
            PINGO will ask for camera access. Nothing is captured or sent until
            you take a Ping.
          </p>

          <div className="mt-9 flex w-full max-w-xs flex-col gap-3">
            <button
              type="button"
              onClick={() => setStage('live')}
              className={cn(
                'focus-ring rounded-full bg-white py-3.5 text-body font-medium text-backdrop',
                'transition-transform duration-instant ease-standard active:scale-[0.98]',
              )}
            >
              Open camera
            </button>

            {/*
              The gallery route needs no permission at all, so it is offered
              beside the camera rather than hidden behind refusing it.
            */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="focus-ring rounded-full bg-white/12 py-3.5 text-body text-white"
            >
              Choose a photo instead
            </button>

            <button
              type="button"
              onClick={() => navigate('/chats')}
              className="focus-ring rounded-full py-2.5 text-body text-white/60"
            >
              Not now
            </button>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) setSnapShot({ kind: file.type.startsWith('video/') ? 'video' : 'photo', blob: file });
          }}
        />
      </div>
    );
  }

  if (stage === 'filter' && shot) {
    return (
      <div className="flex h-full flex-col bg-backdrop">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <img src={shot.url} alt="Your Ping" className="absolute inset-0 size-full object-contain" />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/20">
              <PingoDot state="loading" size={7} label="Applying filter" />
            </div>
          )}
        </div>

        <FilterRail
          selected={filterId}
          onSelect={(id) => void chooseFilter(id)}
          enabled={preferences.camera.filters}
        />

        <div className="flex shrink-0 gap-3 px-6 pt-1 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={reset}
            className="focus-ring flex-1 rounded-full bg-white/12 py-3 text-body text-white"
          >
            Retake
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setStage('edit')}
            className="focus-ring flex-[2] rounded-full bg-white py-3 text-body font-medium text-backdrop disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'edit' && shot) {
    return (
      <SnapEditor
        src={shot.url}
        busy={busy}
        onCancel={() => setStage('filter')}
        onDone={(blob) => {
          show(blob);
          setStage('send');
        }}
      />
    );
  }

  if (stage === 'send' && shot) {
    return (
      <div className="flex h-full flex-col bg-backdrop">
        {/* ---- the picture ------------------------------------------- */}
        <div className="relative min-h-0 flex-[2] overflow-hidden">
          <img
            src={shot.url}
            alt="Your Ping"
            className="animate-fade-in absolute inset-0 size-full object-contain"
          />

          {/*
            The confirmation, over the picture rather than in place of it.

            Replacing the screen would hide the thing that was just sent at the
            exact moment somebody wants to see it go. This sits on top for a
            beat and leaves with the picture underneath it.
          */}
          {sentCount > 0 && (
            <div className="animate-fade-in absolute inset-0 grid place-items-center bg-backdrop/70 backdrop-blur-glass">
              <div className="flex flex-col items-center gap-3">
                <span className="grid size-16 place-items-center rounded-full bg-brand-gradient text-on-brand shadow-brand">
                  <CheckIcon size={30} />
                </span>
                <p className="text-body font-medium text-white" role="status">
                  Ping sent to {sentCount}
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            disabled={busy}
            aria-label="Retake"
            className={cn(
              'touch-target focus-ring absolute top-4 left-4 grid size-10 place-items-center',
              'rounded-full bg-black/45 text-white backdrop-blur-glass',
              'transition-transform duration-instant active:scale-95',
            )}
          >
            <CameraIcon size={19} />
          </button>
        </div>

        {/* ---- how many views, and who ------------------------------- */}
        <div className="flex min-h-0 flex-1 flex-col bg-page">
          <div className="shrink-0 space-y-3 border-b border-line bg-backdrop px-4 py-3">
            <PingViewLimit value={views} onChange={setViews} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
            {error && (
              <p role="alert" className="mb-3 text-center text-caption text-danger">
                {error}
              </p>
            )}

            <PingRecipients
              selected={recipients}
              lockedId={lockedChatId}
              onToggle={(id) =>
                setRecipients((previous) => {
                  // The chat you opened from stays selected - deselecting it
                  // would re-break the "send back to this thread" path.
                  if (lockedChatId && id === lockedChatId) return previous;
                  const next = new Set(previous);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
          </div>

          {/*
            Story and Save sit above Send rather than beside it. They are the
            other two things a picture can become, and putting them on the same
            row as the commit would make three buttons that look interchangeable
            when only one of them ends the flow.
          */}
          <div className="shrink-0 space-y-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex gap-2">
              <SendAction onClick={() => void postStory()} disabled={busy}>
                Add to story
              </SendAction>
              <SendAction onClick={saveToGallery} disabled={busy}>
                Save
              </SendAction>
            </div>

            <PingSendButton
              count={recipients.size}
              busy={busy}
              onSend={() => void sendPing()}
              lockedLabel={lockedChatId ? 'Send' : undefined}
            />
          </div>
        </div>
      </div>
    );
  }


  // ---- live: Snapchat's camera --------------------------------------------------


  return (
    <SnapCamera
      preferred={preferences.camera.defaultCamera === 'back' ? 'environment' : 'user'}
      onShot={setSnapShot}
      onGallery={(file) => setSnapShot({ kind: file.type.startsWith('video/') ? 'video' : 'photo', blob: file })}
      onClose={() => navigate(lockedChatId ? `/chats/${lockedChatId}` : '/chats', { replace: true })}
    />
  );
}

/**
 * The looks, along the bottom.
 *
 * Hidden entirely when Settings → Camera & Pings → Filters is off. That switch
 * existed and was read by nothing: the page said filters "need image processing
 * that is not built yet" while the filter rail sat in the camera working
 * perfectly. The processing was built; the switch was simply never connected to
 * it, which is a worse kind of missing than a feature that is honestly absent.
 */
function FilterRail({
  selected,
  onSelect,
  disabled,
  enabled = true,
}: {
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  enabled?: boolean;
}) {
  if (!enabled) return null;

  return (
    <div className="shrink-0 overflow-x-auto px-4 py-3">
      <div className="flex gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={selected === filter.id}
            disabled={disabled}
            onClick={() => onSelect(filter.id)}
            className={cn(
              'focus-ring shrink-0 rounded-full px-4 py-2 text-caption font-medium',
              'transition-colors duration-instant',
              selected === filter.id ? 'bg-white text-backdrop' : 'bg-white/12 text-white',
              'disabled:opacity-40',
            )}
          >
            {filter.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoundControl({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={(event) => {
        // The frame below listens for taps to focus; a control tap is not one.
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'focus-ring grid size-10 place-items-center rounded-full',
        active ? 'bg-white text-backdrop' : 'bg-black/40 text-white',
      )}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  range,
  value,
  onChange,
  className,
}: {
  label: string;
  range: { min: number; max: number; step: number };
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <div
      className={cn('absolute inset-x-6', className)}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="range"
        aria-label={label}
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-white"
      />
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
        // `min-h-11` rather than padding alone: at `py-2.5` on caption text
        // these came out 36px tall, which is under the 44px bar the rest of the
        // product holds itself to - and they sit directly above the send
        // button, where a thumb aiming for one can find the other.
        'focus-ring min-h-11 flex-1 rounded-full bg-surface px-4 text-caption font-medium text-ink',
        'shadow-sm transition-transform duration-instant active:scale-[0.98]',
        'disabled:opacity-50',
      )}
    >
      {children}
    </button>
  );
}

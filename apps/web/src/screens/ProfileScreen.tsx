import { useChat, useProfile, type FollowState, type GalleryItem, type User } from '@pingo/core';
import {
  Avatar,
  Button,
  ChatIcon,
  ChevronRightIcon,
  GridIcon,
  IconButton,
  ImageIcon,
  LoadingState,
  PhoneIcon,
  PlayIcon,
  Skeleton,
  UsersIcon,
  VideoIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { FollowButton } from '../features/profile/FollowButton.js';

import { ScreenHeader } from '../components/ScreenHeader.js';

/**
 * Profile — for the signed-in user at `/profile`, for anyone else at
 * `/profile/:handle`.
 *
 * One component for both, because the page is the same page; only the action row
 * differs (Settings for yourself, Message and Call for someone else). Forking it
 * would mean two layouts to keep aligned for no gain.
 *
 * The header is a soft brand wash with the avatar overlapping its lower edge —
 * the treatment on the board. Below it, the gallery: a masonry-ish grid with
 * varied tile heights, so a set of photos looks like a collection rather than a
 * spreadsheet.
 */
export function ProfileScreen() {
  const { handle } = useParams<{ handle: string }>();
  const { currentUser, users, service } = useChat();
  const navigate = useNavigate();

  const isSelf = !handle || handle === currentUser?.handle;
  const user: User | undefined = isSelf
    ? currentUser
    : users.find((u) => u.handle === handle);

  const [gallery, setGallery] = useState<GalleryItem[] | undefined>();
  const [follow, setFollow] = useState<FollowState>();
  const [pendingCount, setPendingCount] = useState(0);
  const { service: profileService } = useProfile();

  // Only for your own profile; nobody else's requests are yours to see.
  useEffect(() => {
    if (!isSelf) return;
    let active = true;
    void profileService
      .listFollowRequests()
      .then((list) => { if (active) setPendingCount(list.length); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [profileService, isSelf]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void service.listGallery(user.id).then((items) => {
      if (active) setGallery(items);
    });
    return () => {
      active = false;
    };
  }, [service, user]);

  if (!user) {
    // Reached only for an unknown handle; the shell guarantees a session exists.
    return <LoadingState label="Loading profile" />;
  }

  const directConversationId = isSelf
    ? undefined
    : `c-${user.handle}`;

  return (
    <div className="h-full overflow-y-auto">
      <ScreenHeader
        title={isSelf ? 'Profile' : user.name}
        showBack={!isSelf}
        action={
          isSelf ? (
            <Button variant="text" size="sm" onClick={() => navigate('/settings')}>
              Settings
            </Button>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-2xl px-5 pb-8">
        {/* ---- Identity card --------------------------------------------- */}
        <div className="relative mt-2 overflow-hidden rounded-2xl bg-brand-wash shadow-sm">
          <div className="h-28" aria-hidden />

          <div className="flex flex-col items-center px-6 pb-6">
            {/* Pulled up so it straddles the wash and the card body. */}
            <div className="-mt-14 rounded-full ring-4 ring-surface">
              <Avatar
                name={user.name}
                id={user.id}
                size="xl"
                presence={user.presence.state === 'online' ? 'online' : undefined}
              />
            </div>

            <h1 className="mt-4 text-h1 text-ink">{user.name}</h1>
            <p className="mt-1 text-body text-brand">@{user.handle}</p>

            {/*
              Only on other people. The button is also where the mutual state
              is discovered, so the note below it reads from the same fetch
              rather than asking again.
            */}
            {!isSelf && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <FollowButton userId={user.id} onChange={setFollow} />

                {follow && follow !== 'mutual' && (
                  <p className="max-w-xs text-center text-caption text-text-tertiary">
                    Calls, snaps and stories open up once you both follow each other.
                    You can still message.
                  </p>
                )}
              </div>
            )}

            {user.bio && (
              <p className="mt-3 max-w-sm text-center text-body text-text-secondary">
                {user.bio}
              </p>
            )}

            {!isSelf && (
              <div className="mt-6 flex items-center gap-2">
                <Button
                  variant="primary"
                  leadingIcon={<ChatIcon size={18} />}
                  onClick={() => navigate(`/chats/${directConversationId}`)}
                >
                  Message
                </Button>
                <IconButton label={`Voice call ${user.name}`} variant="filled">
                  <PhoneIcon size={20} />
                </IconButton>
                <IconButton label={`Video call ${user.name}`} variant="filled">
                  <VideoIcon size={20} />
                </IconButton>
              </div>
            )}
          </div>
        </div>

        {/* ---- Gallery ---------------------------------------------------- */}
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="flex items-center gap-2 text-h2 text-ink">
              <GridIcon size={18} className="text-text-tertiary" />
              Gallery
            </h2>
            {gallery && gallery.length > 0 && (
              <span className="text-caption text-text-tertiary">
                {gallery.length} {gallery.length === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>

          {!gallery ? (
            <GallerySkeleton />
          ) : gallery.length === 0 ? (
            <div className="rounded-lg bg-surface px-6 py-12 text-center shadow-sm">
              <ImageIcon size={26} className="mx-auto text-text-tertiary" />
              <p className="mt-3 text-body text-text-secondary">
                {isSelf ? 'Your gallery is empty.' : 'Nothing shared yet.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {gallery.map((item) => (
                <GalleryTile key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>

        {/*
          Only on your own profile, and only when there is something waiting.
          An always-present "0 requests" row is a permanent reminder of nothing.
        */}
        {isSelf && pendingCount > 0 && (
          <button
            type="button"
            onClick={() => navigate('/requests')}
            className={cn(
              'focus-ring mt-8 flex w-full items-center gap-3 rounded-lg',
              'bg-surface px-4 py-3.5 shadow-sm',
              'transition-transform duration-instant active:scale-[0.99]',
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
              <UsersIcon size={18} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-body text-ink">Follow requests</span>
              <span className="block text-caption text-text-secondary">
                {pendingCount} waiting on you
              </span>
            </span>
            <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
          </button>
        )}

        {isSelf && (
          <p className="mt-8 text-center text-caption text-text-tertiary">
            <Link to="/settings" className="focus-ring rounded-sm text-brand hover:underline">
              Manage your account and privacy
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A gallery tile.
 *
 * Seeded media is a CSS gradient rather than a file, so the tile paints it as a
 * background. Real uploads will be `<img>`; the aspect handling is already correct
 * for both because the ratio comes from the item's own dimensions.
 */
function GalleryTile({ item }: { item: GalleryItem }) {
  const portrait = item.height > item.width;

  return (
    <button
      type="button"
      className={cn(
        'group relative overflow-hidden rounded-lg',
        'focus-ring transition-transform duration-quick ease-standard',
        'active:scale-[0.99]',
        // Varied heights so the grid reads as a collection, not a table.
        portrait ? 'aspect-[3/4]' : 'aspect-square',
      )}
      style={{ backgroundImage: item.url }}
      aria-label={item.caption ?? `${item.kind} from gallery`}
    >
      {item.kind === 'video' && (
        <span
          className="absolute inset-0 grid place-items-center"
          aria-hidden
        >
          <span className="grid size-11 place-items-center rounded-full bg-white/85 text-brand shadow-md backdrop-blur-glass">
            <PlayIcon size={18} className="translate-x-px" />
          </span>
        </span>
      )}

      {item.caption && (
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 px-3 py-2 text-left',
            // Scrim only under the text, so the image is not dimmed overall.
            'bg-gradient-to-t from-ink/45 to-transparent',
            'text-caption text-white',
            // Revealed on hover and always visible to keyboard focus.
            'opacity-0 transition-opacity duration-quick ease-standard',
            'group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
        >
          {item.caption}
        </span>
      )}
    </button>
  );
}

function GallerySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="status" aria-label="Loading gallery">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className={i % 3 === 0 ? 'aspect-[3/4]' : 'aspect-square'} />
      ))}
    </div>
  );
}

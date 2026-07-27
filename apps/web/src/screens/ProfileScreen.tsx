import {
  MUTE_DURATIONS,
  useChat,
  useProfile,
  type ChatMediaItem,
  type Post,
  type Profile,
  type ProfileStats,
  type SharedHistory,
} from '@pingo/core';
import {
  Button,
  ChatIcon,
  EditIcon,
  EmptyState,
  IconButton,
  LoadingState,
  MenuIcon,
  MoreIcon,
  PhoneIcon,
  QrIcon,
  UsersIcon,
  VideoIcon,
  cn,
} from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useCall } from '../features/calls/CallProvider.js';
import { useConversationActions } from '../features/conversations/useConversationActions.js';
import { useUnmuteConfirm } from '../features/conversations/useUnmuteConfirm.js';
import { AnimatedCount } from '../features/profile/AnimatedCount.js';
import { CaptionText } from '../features/profile/CaptionText.js';
import { FollowButton } from '../features/profile/FollowButton.js';
import { MediaEmpty, MediaGrid, MediaSkeleton } from '../features/profile/MediaGrid.js';
import { PostComposer } from '../features/profile/PostComposer.js';
import { PostGrid, PostGridSkeleton, PostsEmpty } from '../features/profile/PostGrid.js';
import { PostViewer } from '../features/profile/PostViewer.js';
import { MyProfileMenu, PersonMenu } from '../features/profile/ProfileMenus.js';
import { ProfileAvatar } from '../features/profile/ProfileAvatar.js';
import { ReplacePostSheet } from '../features/profile/ReplacePostSheet.js';
import { ReportSheet } from '../features/profile/ReportSheet.js';
import { Sheet, SheetCancel } from '../components/Sheet.js';
import { ShareProfileSheet, profileLink } from '../features/profile/ShareProfileSheet.js';
import { SharedWithPanel } from '../features/profile/SharedWithPanel.js';
import { useMutuals } from '../features/profile/useMutuals.js';

import { useConfirm } from '../components/ConfirmProvider.js';
import { ScreenHeader } from '../components/ScreenHeader.js';

/**
 * Profile — yours at `/profile`, anyone else's at `/profile/:handle`.
 *
 * One component for both, because the page *is* the same page: the same photo,
 * the same three numbers, the same posts. What differs is the action row and
 * whether the private Media tab exists. Forking it would mean two layouts to
 * keep aligned, and they would stop being aligned within a month.
 *
 * ## What this page counts, and what it deliberately does not
 *
 * Posts, Friends, Groups. There are no followers and no following, and their
 * absence is the point rather than an omission: a one-way follow in PINGO is a
 * request, not a relationship, and an audience size is a number that changes how
 * people behave about the thing they are posting. Friends is the count of mutual
 * follows — people who agreed, both ways.
 *
 * ## Why the Media tab is only on your own profile
 *
 * It shows pictures from your conversations, some of which were sent to exactly
 * one person. A Media tab on somebody else's profile could only ever be empty or
 * wrong, and an always-empty tab that says "private" is a placeholder wearing a
 * lock. So the tab bar has two tabs on your own profile and one on everybody
 * else's — which is also what a reader expects, because the private half of a
 * page does not exist on a page that is not yours.
 */

type Tab = 'posts' | 'media';

export function ProfileScreen() {
  const { handle } = useParams<{ handle: string }>();
  // `updateMine` rather than `profiles.update`: the provider holds the copy the
  // whole app renders from, so a photo changed through the service alone would
  // not appear until the next reload.
  const { profile: mine, service: profiles, update: updateMine } = useProfile();
  const { users, conversations, service: chat } = useChat();
  const { startCall } = useCall();
  const { mute } = useConversationActions();
  const mutuals = useMutuals();
  const confirm = useConfirm();
  const confirmUnmute = useUnmuteConfirm();
  const navigate = useNavigate();

  const isSelf = !handle || handle === mine?.username || handle === mine?.id;

  // ---- who ----------------------------------------------------------------

  const [other, setOther] = useState<Profile | null | undefined>();

  useEffect(() => {
    if (isSelf || !handle) {
      setOther(undefined);
      return;
    }
    let active = true;
    setOther(undefined);
    void profiles
      .find(handle)
      .then((found) => {
        if (active) setOther(found);
      })
      .catch(() => {
        if (active) setOther(null);
      });
    return () => {
      active = false;
    };
  }, [profiles, handle, isSelf]);

  const person = isSelf ? mine : other;

  // ---- what ---------------------------------------------------------------

  const [stats, setStats] = useState<ProfileStats>();
  const [posts, setPosts] = useState<Post[]>();
  const [media, setMedia] = useState<ChatMediaItem[]>();
  const [shared, setShared] = useState<SharedHistory>();
  const [blocked, setBlocked] = useState(false);

  const [tab, setTab] = useState<Tab>('posts');

  // Switching between profiles must not leave the previous person's posts on
  // screen while the new ones load.
  useEffect(() => {
    setPosts(undefined);
    setStats(undefined);
    setShared(undefined);
    setTab('posts');
  }, [handle]);

  const personId = person?.id;

  useEffect(() => {
    if (!personId) return;
    let active = true;

    void profiles
      .stats(personId)
      .then((next) => { if (active) setStats(next); })
      .catch(() => undefined);

    void profiles
      .listPosts(personId)
      .then((next) => { if (active) setPosts(next); })
      .catch(() => { if (active) setPosts([]); });

    if (isSelf) {
      void profiles
        .listChatMedia()
        .then((next) => { if (active) setMedia(next); })
        .catch(() => { if (active) setMedia([]); });
    } else {
      void profiles
        .sharedWith(personId)
        .then((next) => { if (active) setShared(next); })
        .catch(() => undefined);
      void profiles
        .isBlocked(personId)
        .then((next) => { if (active) setBlocked(next); })
        .catch(() => undefined);
    }

    return () => {
      active = false;
    };
  }, [profiles, personId, isSelf]);

  const reload = useCallback(() => {
    if (!personId) return;
    void profiles.listPosts(personId).then(setPosts).catch(() => undefined);
    void profiles.stats(personId).then(setStats).catch(() => undefined);
  }, [profiles, personId]);

  // ---- surfaces -----------------------------------------------------------

  const [menuOpen, setMenuOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState<{ postId?: string } | undefined>();
  const [viewing, setViewing] = useState<Post>();
  const [replacing, setReplacing] = useState(false);
  /** The file chosen for a new or replacement post, before the editor opens. */
  const [pending, setPending] = useState<{ file: File; replaces?: Post }>();
  const [editingCaption, setEditingCaption] = useState<Post>();

  const postFileRef = useRef<HTMLInputElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  /** Set when the file picker was opened to replace one specific post. */
  const replaceTarget = useRef<Post | undefined>(undefined);

  if (person === undefined) return <LoadingState label="Loading profile" />;

  if (person === null) {
    return (
      <div className="h-full overflow-y-auto">
        <ScreenHeader title="Profile" showBack />
        <EmptyState
          icon={<UsersIcon size={28} />}
          title="No such profile"
          description={`Nobody on PINGO goes by @${handle}.`}
        />
      </div>
    );
  }

  const conversation = conversations.find(
    (c) => c.kind === 'direct' && c.participantIds.includes(person.id),
  );
  const canCall = !isSelf && Boolean(mutuals?.has(person.id));
  const roster = users.find((u) => u.id === person.id);
  const online = roster?.presence.state === 'online';
  const showMediaTab = isSelf;

  // ---- actions ------------------------------------------------------------

  /**
   * Starting a post, from wherever it was started.
   *
   * The grid's empty slots and the profile menu both land here, and the rule
   * lives in one place: with room, pick a picture; without, choose which of the
   * three it replaces first. Duplicating that check in two callers is how one
   * of them ends up allowing a fourth.
   */
  const startPost = () => {
    if ((posts?.length ?? 0) >= 3) setReplacing(true);
    else postFileRef.current?.click();
  };

  const openMessage = async () => {
    try {
      const id = conversation?.id ?? (await chat.startDirectConversation(person.id));
      navigate(`/chats/${id}`);
    } catch {
      // Nowhere useful to send them, so the button does not navigate rather
      // than landing on a thread that does not exist.
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileLink(person.username));
    } catch {
      // Clipboard access refused. The share sheet shows the link in full.
    }
    setMenuOpen(false);
  };

  const toggleBlock = async () => {
    setMenuOpen(false);
    const next = !blocked;

    /*
     * Both directions ask, and neither pretends to be the other.
     *
     * Blocking is the destructive one and gets the red button. Unblocking
     * gives something back — but it is still a decision about somebody the
     * user once chose to shut out, and "did you mean to let them back in?" is
     * a fair question to put once. It is the calm button, not the red one.
     */
    const go = next
      ? await confirm({
          title: `Block ${person.displayName}?`,
          description:
            'They will not be able to call you or see your stories, and you will stop being friends. They are not told.',
          confirmLabel: 'Block',
        })
      : await confirm({
          title: `Unblock ${person.displayName}?`,
          description:
            'They will be able to message you again. Being friends is not restored — either of you can ask.',
          tone: 'normal',
          confirmLabel: 'Unblock',
        });
    if (!go) return;

    setBlocked(next);
    try {
      await profiles.setBlocked(person.id, next);
    } catch {
      setBlocked(!next);
    }
  };

  const publish = async (image: Blob, caption: string) => {
    const target = pending?.replaces;
    const post = target
      ? await profiles.replacePost(target.id, { image, caption })
      : await profiles.createPost({ image, caption });

    setPending(undefined);
    setPosts((previous) =>
      target
        ? (previous ?? []).map((p) => (p.id === target.id ? post : p))
        : [post, ...(previous ?? [])],
    );
    if (!target) {
      setStats((previous) => (previous ? { ...previous, posts: previous.posts + 1 } : previous));
    }
  };

  const removePost = async (post: Post) => {
    const go = await confirm({
      title: 'Delete this post?',
      description:
        'It goes for good, along with its likes and comments. A profile holds three, so this frees a slot.',
      confirmLabel: 'Delete',
    });
    if (!go) return;

    setViewing(undefined);
    const previous = posts ?? [];
    setPosts(previous.filter((p) => p.id !== post.id));
    setStats((s) => (s ? { ...s, posts: Math.max(0, s.posts - 1) } : s));
    try {
      await profiles.deletePost(post.id);
    } catch {
      // Put it back, then ask the server what is actually there.
      setPosts(previous);
      reload();
    }
  };

  const changeAvatar = async (file: File) => {
    try {
      const url = await profiles.uploadAvatar(file);
      await updateMine({ avatarUrl: url });
    } catch {
      // Nothing changed, and the previous photo is still on screen.
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <ScreenHeader
        title={isSelf ? 'Profile' : person.displayName}
        showBack
        action={
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={isSelf ? 'Profile menu' : `Options for ${person.displayName}`}
            className={cn(
              // 40px drawn, 44px to hit. Measured at 390px: without this the
              // menu was one of only two targets on the page under the bar.
              'touch-target focus-ring grid size-10 shrink-0 place-items-center rounded-full',
              'text-text-secondary transition-colors duration-instant',
              'hover:bg-hover hover:text-ink active:scale-[0.96]',
            )}
          >
            {isSelf ? <MenuIcon size={22} /> : <MoreIcon size={22} />}
          </button>
        }
      />

      <div className="mx-auto w-full max-w-2xl px-5 pb-10">
        {/* ---- identity ------------------------------------------------- */}
        <div className="flex flex-col items-center pt-6">
          <ProfileAvatar
            name={person.displayName}
            id={person.id}
            src={person.avatarUrl}
            online={online}
            isSelf={isSelf}
            onChangePhoto={() => avatarFileRef.current?.click()}
            onRemovePhoto={() => {
              void (async () => {
                const go = await confirm({
                  title: 'Remove your photo?',
                  description: 'Your monogram takes its place. You can add a new one any time.',
                  confirmLabel: 'Remove photo',
                });
                // The key is present and undefined, which the service reads as
                // "clear it" rather than as "not mentioned".
                if (go) await updateMine({ avatarUrl: undefined });
              })();
            }}
          />

          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change.
              event.target.value = '';
              if (file) void changeAvatar(file);
            }}
          />

          {/*
            `h2`, not `h1`. `ScreenHeader` already contributes the page's one
            `h1`, and measuring the rendered page turned up two of them — which
            leaves a screen reader with no single answer to "what is this page".
            Styled as `text-h1` because it is still the largest thing here.
          */}
          <h2 className="mt-4 text-h1 text-ink">{person.displayName}</h2>
          <p className="mt-0.5 text-body text-text-secondary">@{person.username}</p>

          {person.bio && (
            <p className="mt-3 max-w-sm text-center text-body text-text-secondary">
              <CaptionText text={person.bio} />
            </p>
          )}

          {/* ---- the three numbers -------------------------------------- */}
          <dl className="mt-5 grid w-full max-w-xs grid-cols-3">
            <Stat label="Posts" value={stats?.posts} />
            <Stat label="Friends" value={stats?.friends} />
            <Stat label="Groups" value={stats?.groups} />
          </dl>

          {/* ---- actions ------------------------------------------------ */}
          {isSelf ? (
            <div className="mt-5 flex w-full max-w-xs items-center gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                leadingIcon={<EditIcon size={16} />}
                onClick={() => navigate('/profile/edit')}
              >
                Edit profile
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                leadingIcon={<QrIcon size={16} />}
                onClick={() => setSharing(true)}
              >
                Share profile
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex w-full max-w-xs flex-col items-center gap-2">
              {/*
                Not friends yet, so the request comes first and is the primary
                action. Messaging stays available regardless — PINGO's rule is
                that anyone can message anyone, and a request you cannot send is
                a product nobody can start using.
              */}
              {mutuals && !mutuals.has(person.id) && (
                <FollowButton userId={person.id} name={person.displayName} className="w-full" />
              )}

              <div className="flex w-full items-center gap-2">
                <Button
                  variant="primary"
                  className="flex-1"
                  leadingIcon={<ChatIcon size={16} />}
                  onClick={() => void openMessage()}
                >
                  Message
                </Button>

                <IconButton
                  label={
                    canCall
                      ? `Voice call ${person.displayName}`
                      : `Voice calls open up once you and ${person.displayName} both follow each other`
                  }
                  variant="filled"
                  disabled={!canCall}
                  onClick={() => void startCall(person.id, person.displayName, 'voice')}
                >
                  <PhoneIcon size={20} />
                </IconButton>

                <IconButton
                  label={
                    canCall
                      ? `Video call ${person.displayName}`
                      : `Video calls open up once you and ${person.displayName} both follow each other`
                  }
                  variant="filled"
                  disabled={!canCall}
                  onClick={() => void startCall(person.id, person.displayName, 'video')}
                >
                  <VideoIcon size={20} />
                </IconButton>
              </div>

              {blocked && (
                <p className="text-caption text-danger">
                  You have blocked {person.displayName}.
                </p>
              )}
            </div>
          )}
        </div>

        {!isSelf && shared && <SharedWithPanel history={shared} />}

        {/* ---- tabs ----------------------------------------------------- */}
        <div role="tablist" aria-label="Profile content" className="mt-7 flex border-b border-line">
          <TabButton id="posts" label="Posts" active={tab === 'posts'} onSelect={() => setTab('posts')} />
          {showMediaTab && (
            <TabButton id="media" label="Media" active={tab === 'media'} onSelect={() => setTab('media')} />
          )}
        </div>

        <div
          role="tabpanel"
          id="panel-posts"
          aria-labelledby="tab-posts"
          hidden={tab !== 'posts'}
          className="pt-4"
        >
          {!posts ? (
            <PostGridSkeleton />
          ) : posts.length === 0 && !isSelf ? (
            <PostsEmpty name={person.displayName} />
          ) : (
            <PostGrid
              posts={posts}
              isSelf={isSelf}
              onOpen={setViewing}
              onAdd={startPost}
            />
          )}
        </div>

        {showMediaTab && (
          <div
            role="tabpanel"
            id="panel-media"
            aria-labelledby="tab-media"
            hidden={tab !== 'media'}
            className="pt-4"
          >
            {!media ? <MediaSkeleton /> : media.length === 0 ? <MediaEmpty /> : <MediaGrid items={media} />}
          </div>
        )}
      </div>

      {/* Every post upload goes through this one input. */}
      <input
        ref={postFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) {
            // Cancelled the picker: the pending replacement is off too.
            replaceTarget.current = undefined;
            return;
          }
          setPending({ file, replaces: replaceTarget.current });
          replaceTarget.current = undefined;
        }}
      />

      {/* ---- overlays ---------------------------------------------------- */}

      {menuOpen && isSelf && (
        <MyProfileMenu
          postsFull={(posts?.length ?? 0) >= 3}
          onNewPost={() => {
            setMenuOpen(false);
            startPost();
          }}
          onEdit={() => {
            setMenuOpen(false);
            navigate('/profile/edit');
          }}
          onShare={() => {
            setMenuOpen(false);
            setSharing(true);
          }}
          onSettings={() => {
            setMenuOpen(false);
            navigate('/settings');
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {menuOpen && !isSelf && (
        <PersonMenu
          name={person.displayName}
          muted={conversation ? conversation.muted : undefined}
          blocked={blocked}
          onShare={() => {
            setMenuOpen(false);
            setSharing(true);
          }}
          onCopyLink={() => void copyLink()}
          onMute={() => {
            setMenuOpen(false);
            if (!conversation) return;
            void (async () => {
              if (conversation.muted) {
                if (await confirmUnmute(1, person.displayName)) await mute([conversation.id], null);
                return;
              }
              /*
               * Always, when muting from here. The durations sheet belongs to
               * the chat list, where mute is a bulk action across rows; on one
               * person's profile it is a decision about them, not a timer.
               */
              await mute([conversation.id], MUTE_DURATIONS.at(-1)!.ms);
            })();
          }}
          // `toggleBlock` asks for itself in both directions, so block and
          // unblock go through the same call.
          onBlock={() => void toggleBlock()}
          onReport={() => {
            setMenuOpen(false);
            setReporting({});
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {sharing && (
        <ShareProfileSheet
          username={person.username}
          displayName={person.displayName}
          onClose={() => setSharing(false)}
        />
      )}

      {reporting && (
        <ReportSheet
          subjectName={person.displayName}
          userId={isSelf ? undefined : person.id}
          postId={reporting.postId}
          onClose={() => setReporting(undefined)}
          onBlock={
            isSelf || blocked
              ? undefined
              : () => {
                  setReporting(undefined);
                  void toggleBlock();
                }
          }
        />
      )}


      {replacing && posts && (
        <ReplacePostSheet
          posts={posts}
          onCancel={() => setReplacing(false)}
          onChoose={(post) => {
            setReplacing(false);
            replaceTarget.current = post;
            postFileRef.current?.click();
          }}
        />
      )}

      {pending && (
        <PostComposer
          file={pending.file}
          confirmLabel={pending.replaces ? 'Replace' : 'Share'}
          initialCaption={pending.replaces?.caption ?? ''}
          onCancel={() => setPending(undefined)}
          onDone={publish}
        />
      )}

      {viewing && (
        <PostViewer
          post={viewing}
          author={person}
          isMine={isSelf}
          onClose={() => setViewing(undefined)}
          onChange={(next) => {
            setViewing(next);
            setPosts((previous) => (previous ?? []).map((p) => (p.id === next.id ? next : p)));
          }}
          onEditCaption={() => setEditingCaption(viewing)}
          onReplace={() => {
            replaceTarget.current = viewing;
            setViewing(undefined);
            postFileRef.current?.click();
          }}
          onDelete={() => void removePost(viewing)}
          onReport={() => setReporting({ postId: viewing.id })}
        />
      )}

      {editingCaption && (
        <CaptionEditor
          post={editingCaption}
          onCancel={() => setEditingCaption(undefined)}
          onSave={async (caption) => {
            const next = await profiles.updatePostCaption(editingCaption.id, caption);
            setEditingCaption(undefined);
            setPosts((previous) => (previous ?? []).map((p) => (p.id === next.id ? next : p)));
            setViewing((current) => (current?.id === next.id ? next : current));
          }}
        />
      )}

    </div>
  );
}

/**
 * One of the three numbers.
 *
 * `dd` before `dt` in the markup so the number sits above its label visually,
 * while the pair still reads as one definition — "Posts, 3" — to a screen
 * reader, which walks the list in document order within each group.
 */
function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex flex-col items-center">
      <dt className="sr-only">{label}</dt>
      <dd className="text-h2 font-semibold text-ink tabular-nums">
        {value === undefined ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <AnimatedCount value={value} />
        )}
      </dd>
      <p aria-hidden className="text-caption text-text-secondary">
        {label}
      </p>
    </div>
  );
}

function TabButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: Tab;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      onClick={onSelect}
      className={cn(
        'focus-ring relative flex-1 px-4 py-3 text-body font-medium',
        'transition-colors duration-instant',
        active ? 'text-ink' : 'text-text-tertiary hover:text-text-secondary',
      )}
    >
      {label}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 -bottom-px h-0.5 rounded-full',
          'transition-opacity duration-quick ease-standard',
          active ? 'bg-brand opacity-100' : 'opacity-0',
        )}
      />
    </button>
  );
}

/**
 * Editing the words on a post without touching the picture.
 *
 * A sheet rather than sending the user back through the editor: changing a
 * typo should not mean re-flattening the image and re-uploading it, and
 * `updatePostCaption` writes only the caption for exactly that reason.
 */
function CaptionEditor({
  post,
  onCancel,
  onSave,
}: {
  post: Post;
  onCancel: () => void;
  onSave: (caption: string) => Promise<void>;
}) {
  const [caption, setCaption] = useState(post.caption ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(caption);
    } catch {
      setError('That did not save. Try again.');
      setSaving(false);
    }
  };

  return (
    <Sheet title="Edit caption" onClose={onCancel}>
      <textarea
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        rows={4}
        maxLength={2200}
        autoFocus
        aria-label="Caption"
        placeholder="Write a caption"
        className={cn(
          'focus-ring mt-3 w-full resize-none rounded-lg border border-line bg-page',
          'px-3 py-2.5 text-body text-ink placeholder:text-text-tertiary',
        )}
      />

      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={cn(
            'focus-ring w-full rounded-full px-5 py-3 text-body font-medium',
            'bg-brand-gradient text-white shadow-brand',
            'transition-transform duration-instant active:scale-[0.98]',
            saving && 'opacity-50',
          )}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <SheetCancel onClick={onCancel} />
      </div>
    </Sheet>
  );
}

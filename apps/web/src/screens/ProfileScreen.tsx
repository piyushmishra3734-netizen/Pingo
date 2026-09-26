import {
  MUTE_DURATIONS,
  useChat,
  useProfile,
  type ChatMediaItem,
  type MutualFriends,
  type Post,
  type Profile,
  type ProfileStats,
  type SharedHistory,
} from '@pingo/core';
import {
  Button,
  ChatIcon,
  ChevronRightIcon,
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
import { AtSign, Briefcase, Compass, MapPin, Trophy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { getRealtimeHub } from '../lib/supabase/realtime-hub.js';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useCall } from '../features/calls/CallProvider.js';
import { useConversationActions } from '../features/conversations/useConversationActions.js';
import { useUnmuteConfirm } from '../features/conversations/useUnmuteConfirm.js';
import { AchievementMark } from '../features/achievements/AchievementArt.js';
import { displayTitle } from '../features/achievements/registry.js';
import { mythicAccentStyle, mythicWashStyle } from '../features/achievements/MythicAura.js';
import { useAchievements } from '../features/achievements/useAchievements.js';
import { usePreferences } from '../features/settings/SettingsContext.js';
import { AnimatedCount } from '../features/profile/AnimatedCount.js';
import { AvatarPhotoEditor } from '../features/profile/AvatarPhotoEditor.js';
import { CaptionText } from '../features/profile/CaptionText.js';
import { FriendsSheet, GroupsSheet } from '../features/profile/ConnectionsSheet.js';
import { FollowButton } from '../features/profile/FollowButton.js';
import { MediaEmpty, MediaGrid, MediaSkeleton } from '../features/profile/MediaGrid.js';
import { PostComposer } from '../features/profile/PostComposer.js';
import {
  OwnPostsEmpty,
  PostGrid,
  PostGridSkeleton,
  PostsEmpty,
} from '../features/profile/PostGrid.js';
import { PostViewer } from '../features/profile/PostViewer.js';
import { MyProfileMenu, PersonMenu } from '../features/profile/ProfileMenus.js';
import { ProfileAvatar } from '../features/profile/ProfileAvatar.js';
import { ProfileCover } from '../features/profile/ProfileCover.js';
import { ReplacePostSheet } from '../features/profile/ReplacePostSheet.js';
import { ReportSheet } from '../features/profile/ReportSheet.js';
import { Sheet, SheetCancel } from '../components/Sheet.js';
import { profileLink } from '../features/profile/ShareProfileSheet.js';
import { QrCodeSheet } from '../features/profile/QrCodeSheet.js';
import { useMutuals } from '../features/profile/useMutuals.js';

import { useConfirm } from '../components/ConfirmProvider.js';
import { ScreenHeader } from '../components/ScreenHeader.js';
import { presenceMark, usePresenceStatus } from '../features/presence/status.js';

/**
 * Profile - yours at `/profile`, anyone else's at `/profile/:handle`.
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
 * follows - people who agreed, both ways.
 *
 * ## Why the Media tab is only on your own profile
 *
 * It shows pictures from your conversations, some of which were sent to exactly
 * one person. A Media tab on somebody else's profile could only ever be empty or
 * wrong, and an always-empty tab that says "private" is a placeholder wearing a
 * lock. So the tab bar has two tabs on your own profile and one on everybody
 * else's, which is also what a reader expects, because the private half of a
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
  const myStatus = usePresenceStatus();

  // ---- who ----------------------------------------------------------------

  // Seeded on the first render too, or a known profile still flashes the
  // loading state for one frame before the effect below hands it over.
  const [other, setOther] = useState<Profile | null | undefined>(() =>
    isSelf || !handle ? undefined : profiles.peek?.(handle),
  );

  useEffect(() => {
    if (isSelf || !handle) {
      setOther(undefined);
      return;
    }
    let active = true;
    // Somebody already seen this session paints at once; the fetch below
    // refreshes them. Only a first visit waits.
    setOther(profiles.peek?.(handle));
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
  const [postsFailed, setPostsFailed] = useState(false);
  /** Bumped by Try again; the load effect keys on the person, not the failure. */
  const [attempt, setAttempt] = useState(0);
  const [media, setMedia] = useState<ChatMediaItem[]>();
  const [shared, setShared] = useState<SharedHistory>();
  const [blocked, setBlocked] = useState(false);
  /** My friends who are also theirs. Absent until it loads, or when it cannot. */
  const [mutualFriends, setMutualFriends] = useState<MutualFriends>();

  const [tab, setTab] = useState<Tab>('posts');

  // Switching between profiles must not leave the previous person's posts on
  // screen while the new ones load.
  useEffect(() => {
    setPosts(undefined);
    setStats(undefined);
    setShared(undefined);
    setMutualFriends(undefined);
    setTab('posts');
  }, [handle]);

  const personId = person?.id;

  useEffect(() => {
    if (!personId) return;
    let active = true;
    setPostsFailed(false);

    void profiles
      .stats(personId)
      .then((next) => { if (active) setStats(next); })
      .catch(() => undefined);

    /*
     * A dropped request is not an empty life.
     *
     * This used to catch to `[]`, which renders the same `PostsEmpty` a person
     * with genuinely no posts gets - so a visitor on a bad connection was told
     * a stranger had nothing, with no way to tell that from the truth and no
     * way to ask again. The other reads on this screen degrade quietly on
     * purpose: a missing Journey row or shared-history panel simply is not
     * drawn, which says nothing false. The post grid is the one that does.
     */
    void profiles
      .listPosts(personId)
      .then((next) => { if (active) setPosts(next); })
      .catch(() => { if (active) setPostsFailed(true); });

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

      // Quietly absent on failure: no line is truer than a wrong one.
      void profiles
        .mutualFriends(personId)
        .then((next) => { if (active) setMutualFriends(next); })
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

  /*
   * A profile that keeps up with itself.
   *
   * Every number and every word on this screen came from one fetch on mount, so
   * a bio edited on a phone, a post added, a follow accepted - none of it
   * arrived until the screen was left and re-entered. On your *own* profile
   * that is the strangest version of it: you change something, come back, and
   * the app shows you the old answer about yourself.
   *
   * The filters matter as much as the subscriptions. `profiles` is readable by
   * everyone, so its stream carries every edit on PINGO; without narrowing to
   * the person being looked at, every stranger's bio change would refetch this
   * screen. `follows` has no id to match on, either side of the row can be
   * this person, so it re-reads the counts and nothing else.
   */
  useEffect(() => {
    if (!personId) return;
    const hub = getRealtimeHub();

    const offPosts = hub.on('posts', (change) => {
      const author = (change.row.author_id ?? change.previous.author_id) as string | undefined;
      if (author === personId) reload();
    });

    const offFollows = hub.on('follows', () => {
      // Friends and mutual counts both live in `stats`.
      void profiles.stats(personId).then(setStats).catch(() => undefined);
    });

    const offProfile = hub.on('profiles', (change) => {
      if (change.row.id !== personId) return;
      // Only the other person's copy is fetched here; `mine` is owned by the
      // provider and refreshed by the bridge in App.
      if (isSelf || !handle) return;
      void profiles.find(handle).then(setOther).catch(() => undefined);
    });

    return () => {
      offPosts();
      offFollows();
      offProfile();
    };
  }, [personId, isSelf, handle, profiles, reload, attempt]);

  // ---- surfaces -----------------------------------------------------------

  const [menuOpen, setMenuOpen] = useState(false);
  /** Which of your own lists is open, if either. Your profile only. */
  const [listing, setListing] = useState<'friends' | 'groups'>();
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState<{ postId?: string } | undefined>();
  const [viewing, setViewing] = useState<Post>();
  const [replacing, setReplacing] = useState(false);
  /** The file chosen for a new or replacement post, before the editor opens. */
  const [pending, setPending] = useState<{ file: File; replaces?: Post }>();
  const [editingCaption, setEditingCaption] = useState<Post>();

  const postFileRef = useRef<HTMLInputElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  /*
   * Up here with the others, and that placement is the whole point.
   *
   * This sat next to the cover handlers three hundred lines down - which is
   * *after* the early returns for a profile that has not loaded yet. So the
   * hook ran on the render where the person existed and not on the render
   * before it, the count changed between renders, and React refused to
   * continue: "Rendered more hooks than during the previous render", which
   * arrives as a blank screen.
   *
   * Only on somebody else's profile, because that is the only one that is
   * briefly undefined - your own is already loaded by the time you get here,
   * so both renders had the same hooks and nothing ever went wrong locally.
   */
  const coverFileRef = useRef<HTMLInputElement>(null);
  /** Object URL for the avatar crop editor; nothing uploads until Save. */
  const [avatarEditorSrc, setAvatarEditorSrc] = useState<string>();
  /** Set when the file picker was opened to replace one specific post. */
  const replaceTarget = useRef<Post | undefined>(undefined);

  /*
   * Above the early returns, and it has to be.
   *
   * `person` is undefined on the first render of somebody else's profile and
   * resolves a moment later, so the two returns below run on some renders and
   * not others. A hook called after them is called conditionally: React counts
   * a different number of hooks on the second render than the first, throws,
   * and the screen goes white. That is exactly what shipped - it looked fine
   * opening your own profile, where the provider already had the answer before
   * the first render, and broke on everybody else's.
   *
   * `person?.id` rather than `person.id` for the same reason: this now runs
   * while there is nobody yet, and the hook is built to be asked about nothing.
   */
  const achievements = useAchievements([person?.id]);
  const { preferences } = usePreferences();
  /* The rare layer, asked for by tier so a future badge inherits it. */
  const isMythic = achievements.isMythic(person?.id);

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
  const othersMark = presenceMark(roster?.presence.state);
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
     * gives something back - but it is still a decision about somebody the
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
            'They will be able to message you again. Being friends is not restored. Either of you can ask.',
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

  const openAvatarEditor = (file: File) => {
    if (avatarEditorSrc) URL.revokeObjectURL(avatarEditorSrc);
    setAvatarEditorSrc(URL.createObjectURL(file));
  };

  const closeAvatarEditor = () => {
    if (avatarEditorSrc) URL.revokeObjectURL(avatarEditorSrc);
    setAvatarEditorSrc(undefined);
  };

  /*
   * The cover goes into the same bucket as every other face, unshrunk.
   *
   * `uploadAvatar` puts a square through `encodeAvatar` at avatar pixels, which
   * is exactly wrong for a band four times wider than it is tall - it would
   * arrive soft. `uploadCover` is the same bucket and the same public URL, with
   * the picture left at the size they chose.
   */
  const pickCover = async (file: File) => {
    try {
      const url = await profiles.uploadCover(file);
      await updateMine({ bannerUrl: url });
    } catch {
      // Nothing saved; the old cover is still there.
    }
  };

  const saveAvatarCrop = async (file: File) => {
    try {
      const url = await profiles.uploadAvatar(file);
      await updateMine({ avatarUrl: url });
      // Editor flashes ✓ then closes via onCancel.
    } catch {
      // Keep the editor open so they can try again or cancel.
      throw new Error('upload failed');
    }
  };

  return (
    /*
      The wash sits behind the top of the page, never over it.

      Positioned rather than painted on the scroller so it stays at the top of
      the profile as it scrolls away, and so nothing between it and the reader
      changes: no text is tinted, no control is overlaid, and with it on or off
      every word is exactly as legible. The accent is handed down as a custom
      property for the few details that opt into it.
    */
    <div
      className="relative h-full overflow-y-auto bg-page"
      style={
        isMythic
          ? {
              ...mythicAccentStyle(preferences.mythic.accent),
              ...mythicWashStyle(preferences.mythic.accent),
            }
          : undefined
      }
    >
      {avatarEditorSrc && (
        <AvatarPhotoEditor
          src={avatarEditorSrc}
          onCancel={closeAvatarEditor}
          onChooseAnother={() => avatarFileRef.current?.click()}
          onSave={(file) => void saveAvatarCrop(file)}
          {...(person.avatarUrl
            ? {
                onRemove: async () => {
                  await updateMine({ avatarUrl: undefined });
                },
              }
            : {})}
        />
      )}
      <ScreenHeader
        title={isSelf ? 'Profile' : person.displayName}
        showBack
        action={
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={isSelf ? 'Profile menu' : `Options for ${person.displayName}`}
            className={cn(
              // Same family as the back control: 40 drawn, 44 hit, same weight.
              'touch-target focus-ring grid size-10 shrink-0 place-items-center rounded-full',
              'text-text-secondary transition-colors duration-instant',
              'hover:bg-hover hover:text-ink active:scale-[0.96]',
            )}
          >
            {isSelf ? <MenuIcon size={20} /> : <MoreIcon size={20} />}
          </button>
        }
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-2 pb-10 pt-2">
        {/*
          The whole person is one card.

          The cover fades into the card rather than ending at an edge, and the
          face, the button and every line about them sit on that fade - one
          object with one edge, instead of a band, a circle and a column of text
          that each end somewhere different.

          The body ignores pointer events and only its rows take them back, so
          the part of the cover the text does not cover still answers the drag
          that repositions it.
        */}
        <article className="rounded-[34px] bg-surface/70 p-[5px] ring-1 ring-line">
          <div className="relative overflow-hidden rounded-[29px] bg-surface">
            <ProfileCover
              src={person.bannerUrl}
              offset={person.bannerOffset}
              editable={isSelf}
              onPick={() => coverFileRef.current?.click()}
              onOffsetChange={(next) => void updateMine({ bannerOffset: next })}
            />

            <div className="pointer-events-none relative px-[18px] pb-5 pt-[92px] [&>*]:pointer-events-auto">
              <div className="flex items-end justify-between gap-3">
                {/* `flex`, not `block`: an inline-flex child on a text baseline sits off centre. */}
                <div className="flex">
                  <ProfileAvatar
                    name={person.displayName}
                    id={person.id}
                    src={person.avatarUrl}
                    presence={isSelf ? myStatus : othersMark}
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
                </div>

                {isSelf ? (
                  <Link
                    to="/profile/edit"
                    className={cn(
                      'focus-ring mb-2 inline-flex h-10 items-center gap-1.5 rounded-full px-5',
                      'bg-brand text-caption font-medium text-on-brand',
                      'transition-transform duration-instant active:scale-[0.96]',
                    )}
                  >
                    <EditIcon size={15} />
                    Edit profile
                  </Link>
                ) : (
                  <FollowButton userId={person.id} name={person.displayName} className="mb-2 h-10" />
                )}
              </div>

              {/*
                `h2`, not `h1`. `ScreenHeader` already contributes the page's one
                `h1`, and two of them leave a screen reader with no single answer
                to "what is this page".
              */}
              <h2 className="mt-3 flex items-center gap-1.5 text-[24px] font-bold leading-tight tracking-[-0.04em] text-ink">
                <span className="min-w-0 truncate">{person.displayName}</span>
                <AchievementMark achievement={achievements.lead(person.id)} />
              </h2>

              {/* Two lines at most: a profile is an identity, not an information sheet. */}
              {person.bio && (
                <p className="mt-1 line-clamp-2 text-body leading-snug text-text-secondary">
                  <CaptionText text={person.bio} />
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-text-secondary">
                <Fact icon={<AtSign size={14} />}>{person.username}</Fact>
                {person.work && <Fact icon={<Briefcase size={14} />}>{person.work}</Fact>}
                {person.location && <Fact icon={<MapPin size={14} />}>{person.location}</Fact>}
              </div>

              <dl className="mt-4 flex gap-4">
                <Stat label="Posts" value={stats?.posts} />
                <Stat
                  label="Friends"
                  value={stats?.friends}
                  {...(isSelf ? { onOpen: () => setListing('friends') } : {})}
                />
                <Stat
                  label="Groups"
                  value={stats?.groups}
                  {...(isSelf ? { onOpen: () => setListing('groups') } : {})}
                />
              </dl>

              {/*
                One quiet line each, in the same place on both kinds of profile.

                Somebody else's: who you have in common, the way every social
                app says it. Your own: the collection and the Journey - they used
                to be two sections of their own at the foot of the page, and a
                badge and a level are two facts, not two destinations.
              */}
              {isSelf ? (
                <div className="mt-3.5 flex flex-col gap-2">
                  <Line
                    to={achievements.isMythic(person.id) ? '/profile/achievements' : '/profile/mission'}
                    icon={
                      achievements.lead(person.id) ? (
                        <img
                          src={achievements.lead(person.id)!.art.crest}
                          alt=""
                          className="size-[22px] shrink-0 object-contain"
                        />
                      ) : (
                        <Disc><Trophy size={12} /></Disc>
                      )
                    }
                  >
                    {achievements.lead(person.id) ? (
                      <>
                        <b className="font-semibold text-ink">{displayTitle(achievements.lead(person.id)!)}</b>
                        {' · '}
                        {plural(achievements.all(person.id).length, 'badge')}
                      </>
                    ) : (
                      <>
                        <b className="font-semibold text-ink">Achievements</b> · Nothing earned yet
                      </>
                    )}
                  </Line>
                  <Line to="/profile/journey" icon={<Disc><Compass size={12} /></Disc>}>
                    <b className="font-semibold text-ink">Journey</b> · Badges earned and what is next
                  </Line>
                </div>
              ) : (
                <InCommon
                  friends={mutualFriends}
                  groups={conversations.filter(
                    (c) =>
                      (c.kind === 'group' || c.kind === 'community') &&
                      c.participantIds.includes(person.id),
                  )}
                  groupCount={shared?.mutualGroups}
                />
              )}
            </div>
          </div>
        </article>

        <input
          ref={coverFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pickCover(file);
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
            if (file) openAvatarEditor(file);
          }}
        />

        {/* ---- actions -------------------------------------------------- */}
        {isSelf ? (
          <Button
            variant="secondary"
            className="h-12 w-full rounded-full"
            leadingIcon={<QrIcon size={18} />}
            onClick={() => setSharing(true)}
          >
            Share profile
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {/*
              Message keeps the accent and the width, because it is the reason
              anybody opens somebody's profile. Calls are round and quiet:
              obviously pressable, obviously not the point.
            */}
            <Button
              variant="primary"
              className="h-12 flex-1 rounded-full"
              leadingIcon={<ChatIcon size={17} />}
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
              disabled={!canCall}
              onClick={() => void startCall(person.id, person.displayName, 'voice')}
              className="size-12 shrink-0 rounded-full bg-surface text-ink hover:bg-hover"
            >
              <PhoneIcon size={19} />
            </IconButton>
            <IconButton
              label={
                canCall
                  ? `Video call ${person.displayName}`
                  : `Video calls open up once you and ${person.displayName} both follow each other`
              }
              disabled={!canCall}
              onClick={() => void startCall(person.id, person.displayName, 'video')}
              className="size-12 shrink-0 rounded-full bg-surface text-ink hover:bg-hover"
            >
              <VideoIcon size={19} />
            </IconButton>
          </div>
        )}

        {blocked && (
          <p className="px-3 text-center text-caption text-danger">You have blocked {person.displayName}.</p>
        )}

        {/* ---- tabs ----------------------------------------------------- */}
        {showMediaTab && (
          <div role="tablist" aria-label="Profile content" className="flex rounded-full bg-surface p-1">
            <TabButton id="posts" label="Posts" active={tab === 'posts'} onSelect={() => setTab('posts')} />
            <TabButton id="media" label="Media" active={tab === 'media'} onSelect={() => setTab('media')} />
          </div>
        )}

        <div
          {...(showMediaTab
            ? { role: 'tabpanel', id: 'panel-posts', 'aria-labelledby': 'tab-posts' }
            : {})}
          hidden={tab !== 'posts'}
        >
          {postsFailed ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-body text-ink">Couldn&rsquo;t load posts</p>
              <p className="max-w-xs text-caption text-text-secondary">
                The connection dropped on the way. Nothing is missing from this
                profile.
              </p>
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </div>
          ) : !posts ? (
            <PostGridSkeleton />
          ) : posts.length === 0 && !isSelf ? (
            <PostsEmpty name={person.displayName} />
          ) : posts.length === 0 && isSelf ? (
            <OwnPostsEmpty onAdd={startPost} />
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

      {/*
        The lists behind the two figures. Guarded on `isSelf` here as well as
        where they are opened, so a future change to the stats row cannot leak
        somebody's friends by forgetting one of the two.
      */}
      {listing === 'friends' && isSelf && <FriendsSheet onClose={() => setListing(undefined)} />}
      {listing === 'groups' && isSelf && <GroupsSheet onClose={() => setListing(undefined)} />}

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
        <QrCodeSheet
          username={person.username}
          displayName={person.displayName}
          userId={person.id}
          {...(person.avatarUrl ? { avatarUrl: person.avatarUrl } : {})}
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

/** "1 badge", "2 badges". Only ever regular plurals here. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One short fact under the bio: an icon and a few words. */
function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-text-tertiary">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A small round holder for an icon, the size of a face in a line. */
function Disc({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-sunken text-ink">
      {children}
    </span>
  );
}

/** One line at the foot of the card: a picture, some words, and somewhere to go if there is one. */
function Line({ icon, to, children }: { icon: ReactNode; to?: string; children: ReactNode }) {
  const inside = (
    <>
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {to ? <ChevronRightIcon size={15} className="ml-auto shrink-0 text-text-tertiary" /> : null}
    </>
  );
  const shape = 'flex min-w-0 items-center gap-2 text-[12.5px] text-text-secondary';
  return to ? (
    <Link to={to} className={cn(shape, 'focus-ring -m-1 rounded-lg p-1')}>
      {inside}
    </Link>
  ) : (
    <p className={shape}>{inside}</p>
  );
}

/** Up to three overlapping faces - round for people, rounded squares for groups. */
function Pile({ items, square = false }: { items: { key: string; src?: string; label: string }[]; square?: boolean }) {
  return (
    <span className="flex shrink-0">
      {items.slice(0, 3).map((item, i) => (
        <span
          key={item.key}
          className={cn(
            'grid size-[22px] place-items-center overflow-hidden bg-sunken text-[10px] font-semibold text-ink ring-2 ring-surface',
            square ? 'rounded-[7px]' : 'rounded-full',
            i > 0 && '-ml-[7px]',
          )}
        >
          {item.src ? (
            <img src={item.src} alt="" className="size-full object-cover" />
          ) : (
            item.label.trim().charAt(0).toUpperCase()
          )}
        </span>
      ))}
    </span>
  );
}

/** "aarav, riya and 16 others", with the names in the ink colour. */
function Names({ names, rest, unit }: { names: string[]; rest: number; unit: string }) {
  const parts: ReactNode[] = names.map((name) => (
    <b key={name} className="font-semibold text-ink">
      {name}
    </b>
  ));
  if (rest > 0) {
    parts.push(
      <b key="rest" className="font-semibold text-ink">
        {rest} {rest === 1 ? unit : `${unit}s`}
      </b>,
    );
  }
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i === 0 ? '' : i === parts.length - 1 ? ' and ' : ', '}
          {part}
        </span>
      ))}
    </>
  );
}

/**
 * What you and this person have in common, the way every social app says it.
 *
 * Friends come from the server, because who somebody else is friends with is
 * not readable here - only which of *your* friends are also theirs. Groups
 * come from your own chat list, which already knows their names; the server's
 * count covers any that are not loaded. Neither line is drawn at zero.
 */
function InCommon({
  friends,
  groups,
  groupCount,
}: {
  friends: MutualFriends | undefined;
  groups: { id: string; title: string; avatarUrl?: string }[];
  groupCount: number | undefined;
}) {
  const groupTotal = Math.max(groupCount ?? 0, groups.length);
  if (!friends?.total && groupTotal === 0) return null;

  const friendNames = (friends?.sample ?? []).slice(0, 2).map((f) => f.displayName);
  const groupNames = groups.slice(0, 2).map((g) => g.title);

  return (
    <div className="mt-3.5 flex flex-col gap-2">
      {friends && friends.total > 0 ? (
        <Line
          icon={
            <Pile
              items={friends.sample.map((f) => ({
                key: f.id,
                label: f.displayName,
                ...(f.avatarUrl ? { src: f.avatarUrl } : {}),
              }))}
            />
          }
        >
          Friends with <Names names={friendNames} rest={friends.total - friendNames.length} unit="other" />
        </Line>
      ) : null}
      {groupTotal > 0 ? (
        <Line
          icon={
            groups.length > 0 ? (
              <Pile
                square
                items={groups.map((g) => ({
                  key: g.id,
                  label: g.title,
                  ...(g.avatarUrl ? { src: g.avatarUrl } : {}),
                }))}
              />
            ) : (
              <Disc>
                <UsersIcon size={12} />
              </Disc>
            )
          }
        >
          {groupNames.length > 0 ? (
            <>
              Both in <Names names={groupNames} rest={groupTotal - groupNames.length} unit="more" />
            </>
          ) : (
            <>
              <b className="font-semibold text-ink">{plural(groupTotal, 'group')}</b> together
            </>
          )}
        </Line>
      ) : null}
    </div>
  );
}

/**
 * One of the three numbers, said as words: "128 Posts".
 *
 * `dd` before `dt` so the figure leads visually while the pair still reads as
 * one definition to a screen reader.
 */
function Stat({
  label,
  value,
  onOpen,
}: {
  /** Plural. The singular is this without its last letter. */
  label: string;
  value: number | undefined;
  /** Present when this figure leads somewhere. */
  onOpen?: () => void;
}) {
  // "1 Friend", not "1 Friends".
  const shown = value === 1 ? label.replace(/s$/, '') : label;

  const inside = (
    <>
      <dd className="font-semibold tabular-nums text-ink">
        {value === undefined ? <span className="text-text-tertiary">-</span> : <AnimatedCount value={value} />}
      </dd>
      <dt className="ml-1 text-text-secondary">{shown}</dt>
    </>
  );

  const shape = 'flex items-baseline text-[13px]';
  if (!onOpen) return <div className={shape}>{inside}</div>;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}, see the list`}
      className={cn(shape, 'focus-ring -m-1 rounded-lg p-1 transition-colors duration-instant hover:bg-hover active:scale-[0.97]')}
    >
      {inside}
    </button>
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
        'focus-ring h-10 flex-1 rounded-full text-body font-medium',
        'transition-colors duration-instant',
        active ? 'bg-brand text-on-brand' : 'text-text-secondary hover:text-ink',
      )}
    >
      {label}
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
            'bg-brand-gradient text-on-brand shadow-brand',
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

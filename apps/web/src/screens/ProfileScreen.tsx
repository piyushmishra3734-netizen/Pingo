import {
  MUTE_DURATIONS,
  useChat,
  useProfile,
  type ChatMediaItem,
  type Post,
  type Profile,
  type ProfileStats,
  type PublicJourney,
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
import { useCallback, useEffect, useRef, useState } from 'react';

import { getRealtimeHub } from '../lib/supabase/realtime-hub.js';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useCall } from '../features/calls/CallProvider.js';
import { useConversationActions } from '../features/conversations/useConversationActions.js';
import { useUnmuteConfirm } from '../features/conversations/useUnmuteConfirm.js';
import { AchievementArt, AchievementMark } from '../features/achievements/AchievementArt.js';
import { mythicAccentStyle, mythicWashStyle } from '../features/achievements/MythicAura.js';
import { useAchievements } from '../features/achievements/useAchievements.js';
import { usePreferences } from '../features/settings/SettingsContext.js';
import { ProfileJourney } from '../features/journey/ProfileJourney.js';
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
import { SharedWithPanel } from '../features/profile/SharedWithPanel.js';
import { useMutuals } from '../features/profile/useMutuals.js';

import { useConfirm } from '../components/ConfirmProvider.js';
import { ScreenHeader } from '../components/ScreenHeader.js';

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
  /** The public half of their Journey. Absent until it loads, or for ever. */
  const [journey, setJourney] = useState<PublicJourney | null>(null);

  const [tab, setTab] = useState<Tab>('posts');

  // Switching between profiles must not leave the previous person's posts on
  // screen while the new ones load.
  useEffect(() => {
    setPosts(undefined);
    setStats(undefined);
    setShared(undefined);
    setJourney(null);
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

      /*
       * Their Journey, read once per profile.
       *
       * Never for your own — that screen is one tap away in full, and a summary
       * of it here would be the same page twice. Never blocking either: a
       * profile must open whether or not this answers, which is also what makes
       * the migration safe to apply after the code ships.
       */
      void profiles
        .publicJourney(personId)
        .then((next) => { if (active) setJourney(next); })
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
  }, [personId, isSelf, handle, profiles, reload]);

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

  const coverFileRef = useRef<HTMLInputElement>(null);

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

      <div className="mx-auto w-full max-w-2xl px-5 pb-10">
        {/*
          Hero as one composition: avatar → name → handle/bio → stats → actions.
          8pt rhythm (8 / 16 / 24 / 32) keeps the identity block unified.
        */}
        {/*
          The face sits *in* the cover, not under it.

          Stacked the obvious way first - band, then avatar pulled up by a
          negative margin - and it cost about a hundred and ten pixels of
          nothing: the cover ended, the face began, and the name was pushed so
          far down that a phone showed the cover and a chin and no posts.

          Absolutely centred inside the band instead, so the two occupy one
          block rather than two. The overlay ignores pointer events and only the
          face takes them back, or the middle of the cover - which is most of it
          - would stop answering the drag that repositions it.
        */}
        <div className="relative">
          <ProfileCover
            src={person.bannerUrl}
            offset={person.bannerOffset}
            editable={isSelf}
            onPick={() => coverFileRef.current?.click()}
            onOffsetChange={(next) => void updateMine({ bannerOffset: next })}
          />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="pointer-events-auto">

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

        {/*
          Pulled up over the band, the way every profile does it. The negative
          margin is on the identity block rather than the avatar so the name and
          everything under it rise with it and the 8pt rhythm survives.
        */}
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
            </div>
          </div>
        </div>

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

        {/*
          The name starts here, immediately under the band.

          `pt-3` and not the old `pt-6`: the air that used to be above the face
          is now inside the cover, so keeping it would put the gap back in a
          different place.
        */}
        <div className="flex flex-col items-center pt-3">

          {/*
            `h2`, not `h1`. `ScreenHeader` already contributes the page's one
            `h1`, and measuring the rendered page turned up two of them - which
            leaves a screen reader with no single answer to "what is this page".
            Styled as `text-h1` because it is still the largest thing here.
          */}
          <h2 className="mt-1.5 flex items-center justify-center gap-1.5 text-h1 tracking-tight text-ink">
            {person.displayName}
            {/*
              No size here any more.

              This carried `size-6` to undo a mark that was fixed at sixteen
              pixels and therefore wrong beside a `text-h1` name. `AchievementMark`
              now sizes itself from the text it follows, which is the same answer
              in both places and one this screen does not have to know.
            */}
            <AchievementMark achievement={achievements.lead(person.id)} />
          </h2>

          {/* Handle + bio as one quiet identity group under the name. */}
          <div className="mt-1 flex max-w-sm flex-col items-center gap-1.5">
            <p className="text-caption text-text-tertiary">@{person.username}</p>
            {person.bio && (
              <p className="text-center text-body text-text-secondary">
                <CaptionText text={person.bio} />
              </p>
            )}
          </div>

          {/*
            The achievement, at the size it was drawn.

            Shown only to somebody who has it: an empty trophy case on every
            profile in the product would make the badge look like a slot nobody
            fills rather than something rare. The owner's own route into the
            mission lives on their own profile below, which is where somebody
            goes looking for "how do I get that".
          */}
          {achievements.lead(person.id) && (
            /*
              The achievement standing in the page on its own.

              No plate, no border, no panel. A card around this turned it into a
              product tile - the visual language of a landing page, on the
              profile of a private messenger. What somebody earned belongs here
              the way their bio does: part of who they are, not a section about
              them.

              Whichever achievement leads, not a named one. The day there is a
              second rare badge this draws it without being touched.
            */
            <div className="mt-6 flex flex-col items-center gap-2">
              <AchievementArt
                achievement={achievements.lead(person.id)!}
                size="medium"
                aura={preferences.mythic.aura}
              />
              <p className="text-body font-semibold tracking-[0.14em] text-ink">
                {achievements.lead(person.id)!.title}
              </p>
            </div>
          )}

          {/*
            Your own collection, and your own way to the mission.

            One row, named and nothing else - no requirement, no count, no
            invitation. Everything about how a badge is earned lives on the
            mission screen. A profile is not where somebody is sold a thing to
            go and do.
          */}
          {isSelf && (
            <Link
              to={achievements.isMythic(person.id) ? '/profile/achievements' : '/profile/mission'}
              className="focus-ring mt-6 flex w-full max-w-xs items-center gap-3 rounded-lg p-3 text-left"
            >
              {achievements.lead(person.id) ? (
                <AchievementArt
                  achievement={achievements.lead(person.id)!}
                  size="small"
                  className="size-9"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-9 place-items-center rounded-full bg-hover text-caption font-semibold tracking-widest text-text-tertiary"
                >
                  ???
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">Achievements</span>
                <span className="block text-caption text-text-secondary">
                  {achievements.lead(person.id)?.title ?? 'Nothing earned yet'}
                </span>
              </span>
              <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
            </Link>
          )}

          {/* Stats sit in the hero stack, not a separate band. */}
          {/*
            Two of the three open a list, and only on your own profile.

            Who somebody is friends with and which groups they are in is a map
            of their private life; a follower count on a public network is not
            the same thing, and this product does not have followers. So the
            numbers stay numbers on anybody else's page.
          */}
          <dl className="mt-4 grid w-full max-w-xs grid-cols-3">
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

          {/* ---- actions ------------------------------------------------ */}
          {isSelf ? (
            <div className="mt-4 flex w-full max-w-xs items-center gap-2">
              {/*
                Edit is the primary identity action. Share is available but
                quieter so the row has a clear first answer.
              */}
              <Button
                variant="primary"
                className="h-11 flex-1"
                leadingIcon={<EditIcon size={16} />}
                onClick={() => navigate('/profile/edit')}
              >
                Edit profile
              </Button>
              <Button
                variant="secondary"
                className="h-11 flex-1 border-line/60 bg-surface/90 shadow-none"
                leadingIcon={<QrIcon size={16} />}
                onClick={() => setSharing(true)}
              >
                Share profile
              </Button>
            </div>
          ) : null}

          {/*
            Journey, and only on your own profile.

            A collection is something you keep, not something you show — putting
            it on other people's profiles would turn badges into a rank visible
            to strangers, which is a different product from the one the sheet was
            drawn for. It sits under the actions rather than beside them because
            it is somewhere to go, not something to do.
          */}
          {isSelf ? (
            <button
              type="button"
              onClick={() => navigate('/profile/journey')}
              className={cn(
                'mt-3 flex w-full max-w-xs items-center justify-between gap-3',
                'rounded-xl border border-line/60 bg-surface/90 px-4 py-3 text-left',
                'transition-transform duration-instant ease-standard',
                'active:scale-[0.98] motion-reduce:active:scale-100',
              )}
            >
              <span className="min-w-0">
                <span className="block text-body font-medium">Journey</span>
                <span className="block truncate text-caption text-text-secondary">
                  Badges you have earned
                </span>
              </span>
              <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
            </button>
          ) : null}

          {!isSelf ? (
            <div className="mt-4 flex w-full max-w-xs flex-col items-center gap-2">
              {/*
                Not friends yet, so the request comes first and is the primary
                action. Messaging stays available regardless - PINGO's rule is
                that anyone can message anyone, and a request you cannot send is
                a product nobody can start using.
              */}
              {mutuals && !mutuals.has(person.id) && (
                <FollowButton userId={person.id} name={person.displayName} className="w-full" />
              )}

              <div className="flex w-full items-center gap-2">
                <Button
                  variant="primary"
                  className="h-11 flex-1"
                  leadingIcon={<ChatIcon size={16} />}
                  onClick={() => void openMessage()}
                >
                  Message
                </Button>

                {/*
                  Same height / radius family as Message, glass surface so they
                  read as siblings of the primary rather than ghost chrome.
                */}
                <IconButton
                  label={
                    canCall
                      ? `Voice call ${person.displayName}`
                      : `Voice calls open up once you and ${person.displayName} both follow each other`
                  }
                  disabled={!canCall}
                  onClick={() => void startCall(person.id, person.displayName, 'voice')}
                  className={cn(
                    'size-11 shrink-0 rounded-md',
                    'border border-line/70 bg-surface/90 text-ink shadow-sm',
                    'hover:bg-hover hover:border-line-strong',
                  )}
                >
                  <PhoneIcon size={18} />
                </IconButton>

                <IconButton
                  label={
                    canCall
                      ? `Video call ${person.displayName}`
                      : `Video calls open up once you and ${person.displayName} both follow each other`
                  }
                  disabled={!canCall}
                  onClick={() => void startCall(person.id, person.displayName, 'video')}
                  className={cn(
                    'size-11 shrink-0 rounded-md',
                    'border border-line/70 bg-surface/90 text-ink shadow-sm',
                    'hover:bg-hover hover:border-line-strong',
                  )}
                >
                  <VideoIcon size={18} />
                </IconButton>
              </div>

              {blocked && (
                <p className="text-caption text-danger">
                  You have blocked {person.displayName}.
                </p>
              )}
            </div>
          ) : null}
        </div>

        {!isSelf && shared && <SharedWithPanel history={shared} />}

        {/*
          Their Journey, above the tabs and below what they share with you.

          Only on other people's profiles: your own is one tap away in full, and
          a summary of it here would be the same screen twice. It is absent
          rather than empty when they have never published — a section that says
          "nothing yet" about somebody else is a comment on them.
        */}
        {!isSelf ? (
          <ProfileJourney
            {...(journey ? { badgeIds: journey.badgeIds } : {})}
            className="mt-6"
          />
        ) : null}

        {/* ---- tabs ----------------------------------------------------- */}
        <div
          role="tablist"
          aria-label="Profile content"
          className={cn(
            'flex border-b border-line/60',
            // 8pt: 32px from hero actions to content chrome.
            isSelf ? 'mt-8' : 'mt-6',
          )}
        >
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

/**
 * One of the three numbers.
 *
 * `dd` before `dt` in the markup so the number sits above its label visually,
 * while the pair still reads as one definition - "Posts, 3" - to a screen
 * reader, which walks the list in document order within each group.
 */
function Stat({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: number | undefined;
  /** Present when this figure leads somewhere - see the stats block. */
  onOpen?: () => void;
}) {
  const inside = (
    <>
      <dt className="sr-only">{label}</dt>
      <dd className="text-h2 font-semibold tabular-nums leading-none text-ink">
        {value === undefined ? (
          <span className="text-text-tertiary"> - </span>
        ) : (
          <AnimatedCount value={value} />
        )}
      </dd>
      {/* ~2–3px under the number; quieter so the figure stays primary. */}
      <p aria-hidden className="mt-1 text-caption leading-none text-text-tertiary">
        {label}
      </p>
    </>
  );

  if (!onOpen) {
    return <div className="flex flex-col items-center text-center">{inside}</div>;
  }

  /*
   * A button that looks like the figure next to it.
   *
   * Making it look tappable - a chevron, a pill, a colour - would say that
   * this number is a different kind of thing from Posts, which it is not. The
   * press state is the whole affordance, which is what a stat row in every
   * app of this shape does.
   */
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}, see the list`}
      className={cn(
        'focus-ring flex flex-col items-center rounded-xl py-1 text-center',
        'transition-[background-color,transform] duration-instant',
        'hover:bg-hover active:scale-[0.97]',
      )}
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
        'focus-ring relative flex-1 px-4 py-3 text-body font-medium',
        'transition-colors duration-instant',
        active ? 'text-ink' : 'text-text-tertiary hover:text-text-secondary',
      )}
    >
      {label}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-brand',
          // Calmer active mark: softer and not edge-to-edge.
          'transition-opacity duration-150 ease-standard',
          active ? 'opacity-70' : 'opacity-0',
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

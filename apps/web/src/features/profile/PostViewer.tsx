import { useProfile, type Post, type PostComment, type Profile } from '@pingo/core';
import { Avatar, CloseIcon, SendIcon, cn } from '@pingo/ui';
import { Bookmark, ChevronLeft, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { CaptionText } from './CaptionText.js';
import { SharePostSheet } from './SharePostSheet.js';
import { UploadToast, type UploadNote } from '../stories/StoryUpload.js';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Overlay } from '../../components/Overlay.js';
import { useT } from '../i18n/useT.js';

/**
 * A post, full screen.
 *
 * ## Why the actions are optimistic
 *
 * A like that waits for the network before filling in feels broken on a phone,
 * where the round trip is a visible fraction of a second. So the heart fills
 * immediately and the request follows; if it fails, the heart goes back. The
 * count moves with it, because a filled heart above an unchanged number is a
 * worse lie than either alone.
 *
 * ## Why comments load on demand
 *
 * The grid shows three posts and only one is ever open. Loading every post's
 * comments to display a number would be three requests for something nobody has
 * asked to read yet - the count comes from the post, and the comments
 * themselves arrive when the viewer does.
 */

export interface PostViewerProps {
  post: Post;
  author: Profile;
  /** The signed-in user owns this post: edit, replace and delete are offered. */
  isMine: boolean;
  onClose: () => void;
  /** Reflects likes, saves and comment counts back into the grid. */
  onChange: (post: Post) => void;
  onEditCaption: () => void;
  onReplace: () => void;
  onDelete: () => void;
  onReport: () => void;
  /** Share → Add to story: the post, as a sticker, in the story editor. */
  onAddToStory?: (audience: 'friends' | 'close') => void;
}

export function PostViewer({
  post,
  author,
  isMine,
  onClose,
  onChange,
  onEditCaption,
  onReplace,
  onDelete,
  onReport,
  onAddToStory,
}: PostViewerProps) {
  const t = useT();
  const { service } = useProfile();
  const confirm = useConfirm();

  const [comments, setComments] = useState<PostComment[] | undefined>();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState<string>();
  const [showComments, setShowComments] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<UploadNote>();
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(undefined), 1900);
    return () => window.clearTimeout(t);
  }, [note]);

  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * Focus moves in once, on open, and never again.
   *
   * Combining this with the key handler below meant it re-ran whenever
   * `showComments` changed or the parent re-rendered - and since `onClose` is
   * an inline arrow, that was every render. Opening the comments therefore
   * pulled focus back to this button a beat after the input had taken it, so
   * typing went nowhere and Enter pressed Close instead of posting the comment.
   */
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape closes the innermost thing first, which is what every nested
      // surface in the product does.
      if (sharing) setSharing(false);
      else if (menuOpen) setMenuOpen(false);
      else if (showComments) setShowComments(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, menuOpen, showComments, sharing]);

  const openComments = () => {
    setShowComments(true);
    if (comments) return;
    void service
      .listComments(post.id)
      .then(setComments)
      .catch(() => setComments([]));
  };

  const toggleLike = () => {
    const liked = !post.likedByMe;
    // Straight away, then the request. See the note above.
    onChange({ ...post, likedByMe: liked, likeCount: post.likeCount + (liked ? 1 : -1) });
    void service.setPostLiked(post.id, liked).catch(() => {
      onChange({ ...post, likedByMe: !liked, likeCount: post.likeCount });
    });
  };

  const toggleSave = () => {
    const saved = !post.savedByMe;
    onChange({ ...post, savedByMe: saved });
    void service.setPostSaved(post.id, saved).catch(() => {
      onChange({ ...post, savedByMe: !saved });
    });
  };

  /*
   * Optimistic, like the save above it: the menu closes on the tap and the
   * numbers go with it, and a failure puts them back rather than leaving the
   * post looking like it did something it did not.
   */
  const toggleLikeCount = async () => {
    const hidden = !post.hideLikeCount;
    onChange({ ...post, hideLikeCount: hidden });
    try {
      await service.setPostCountsHidden(post.id, { likes: hidden });
    } catch {
      onChange({ ...post, hideLikeCount: !hidden });
    }
  };

  const toggleCommentCount = async () => {
    const hidden = !post.hideCommentCount;
    onChange({ ...post, hideCommentCount: hidden });
    try {
      await service.setPostCountsHidden(post.id, { comments: hidden });
    } catch {
      onChange({ ...post, hideCommentCount: !hidden });
    }
  };

  const submitComment = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setCommentError(undefined);
    try {
      const comment = await service.addComment(post.id, body);
      setComments((previous) => [...(previous ?? []), comment]);
      setDraft('');
      onChange({ ...post, commentCount: post.commentCount + 1 });
    } catch {
      /*
       * Said out loud, not swallowed.
       *
       * This caught silently at first, on the theory that leaving the text in
       * the box was recovery enough. It is not: a comment that was rejected by
       * the server looks exactly like one that was never sent, and the first
       * real failure here, a broken embed returning 400, was invisible from
       * the screen. A press that does nothing has to say so.
       */
      setCommentError('That comment did not post. Try again.');
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (comment: PostComment) => {
    const go = await confirm({
      title: t('post.deleteCommentQ'),
      // Named rather than described. Comments are short and there may be
      // several; quoting it is how you know you are deleting the right one.
      description: `“${comment.body.slice(0, 80)}${comment.body.length > 80 ? '…' : ''}”`,
      confirmLabel: 'Delete',
    });
    if (!go) return;

    const previous = comments ?? [];
    setComments(previous.filter((c) => c.id !== comment.id));
    onChange({ ...post, commentCount: Math.max(0, post.commentCount - 1) });
    try {
      await service.deleteComment(comment.id);
    } catch {
      setComments(previous);
      onChange({ ...post, commentCount: post.commentCount });
    }
  };

  const posted = new Date(post.createdAt);

  return (
    <Overlay onDismiss={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Post by ${author.displayName}`}
        className="fixed inset-0 z-1000 overflow-y-auto bg-page text-ink"
        style={{ animation: 'pv-in .32s cubic-bezier(.2,.8,.2,1)' }}
      >
        <style>{'@keyframes pv-in { from { transform: translateX(100%) } }'}</style>
        {/* The sample's post page: "Posts", then the post as a feed shows it. */}
        <div className="mx-auto w-full max-w-xl pb-24">
          <div className="sticky top-0 z-[2] flex items-center gap-2 bg-page/92 px-2.5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Back" className="focus-ring grid size-9 place-items-center rounded-full [&>svg]:size-[22px]">
              <ChevronLeft />
            </button>
            <b className="flex-1 text-[16px]">Posts</b>
          </div>

          <article>
            <header className="flex items-center gap-2.5 px-3 py-2.5">
              <Avatar name={author.displayName} id={author.id} src={author.avatarUrl} size="xs" />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[14px]">{author.username}</b>
                <span className="block text-[12px] text-text-tertiary">
                  <time dateTime={posted.toISOString()}>{posted.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</time>
                  {post.editedAt && ' · edited'}
                </span>
              </div>
              <div className="relative">
                <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={t('post.options')} aria-expanded={menuOpen}
                  className="focus-ring grid size-9 place-items-center rounded-full [&>svg]:size-5"><MoreHorizontal /></button>
            {menuOpen && (
              <>
                {/*
                  A full-screen catcher rather than a document listener: it
                  closes the menu on the same tap that does nothing else, and it
                  cannot be left behind if this unmounts mid-gesture.
                */}
                <div
                  className="fixed inset-0 z-10"
                  onPointerDown={() => setMenuOpen(false)}
                  aria-hidden
                />
                <div
                  role="menu"
                  className={cn(
                    'animate-panel-in absolute top-11 right-0 z-20 w-48',
                    'overflow-hidden rounded-lg border border-line bg-surface shadow-lg',
                  )}
                >
                  {isMine ? (
                    <>
                      <MenuAction label={t('post.editCaption')} onClick={() => { setMenuOpen(false); onEditCaption(); }} />
                      <MenuAction label={t('post.replacePhoto')} onClick={() => { setMenuOpen(false); onReplace(); }} />
                      {/*
                        Where Instagram keeps it, and where somebody looks for
                        it: on the post itself rather than in settings, because
                        it is a decision about this picture and not about the
                        account.
                      */}
                      <MenuAction
                        label={post.hideLikeCount ? t('post.showLikes') : t('post.hideLikes')}
                        onClick={() => {
                          setMenuOpen(false);
                          void toggleLikeCount();
                        }}
                      />
                      <MenuAction
                        label={
                          post.hideCommentCount ? t('post.showCommentCount') : t('post.hideCommentCount')
                        }
                        onClick={() => {
                          setMenuOpen(false);
                          void toggleCommentCount();
                        }}
                      />
                      <MenuAction label={t('post.delete')} tone="danger" onClick={() => { setMenuOpen(false); onDelete(); }} />
                    </>
                  ) : (
                    <MenuAction label={t('post.report')} tone="danger" onClick={() => { setMenuOpen(false); onReport(); }} />
                  )}
                </div>
              </>
            )}
              </div>
            </header>

            <img src={post.imageUrl} alt={post.caption ?? `Post by ${author.displayName}`} className="block aspect-[4/5] w-full object-cover" />

            <footer className="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
              <button type="button" onClick={toggleLike} aria-label={post.likedByMe ? t('post.unlike') : t('post.like')} aria-pressed={post.likedByMe}
                className={cn('grid size-[38px] place-items-center [&>svg]:size-6', post.likedByMe && 'text-[#ff3040]')}>
                <Heart fill={post.likedByMe ? '#ff3040' : 'none'} style={post.likedByMe ? { animation: 'pv-pop .35s cubic-bezier(.34,1.56,.64,1)' } : undefined} />
              </button>
              {(!post.hideLikeCount || isMine) && <span className="mr-2 text-[14px] font-semibold">{post.likeCount}</span>}
              <button type="button" onClick={openComments} aria-label={`Comments (${post.commentCount})`} className="grid size-[38px] place-items-center [&>svg]:size-6"><MessageCircle /></button>
              {(!post.hideCommentCount || isMine) && <span className="mr-2 text-[14px] font-semibold">{post.commentCount}</span>}
              <button type="button" onClick={() => setSharing(true)} aria-label="Share" className="grid size-[38px] place-items-center [&>svg]:size-6"><Send /></button>
              <span className="flex-1" />
              <button type="button" onClick={toggleSave} aria-label={t('post.save')} aria-pressed={post.savedByMe} className="grid size-[38px] place-items-center [&>svg]:size-6">
                <Bookmark fill={post.savedByMe ? 'currentColor' : 'none'} />
              </button>
            </footer>
            <style>{'@keyframes pv-pop { 0% { transform: scale(.4) } 60% { transform: scale(1.3) } 100% { transform: scale(1) } }'}</style>

            {post.caption && (
              <p className="px-3.5 pt-0.5 text-[14px]">
                <b>{author.username} </b>
                <CaptionText text={post.caption} />
              </p>
            )}
            {post.commentCount > 0 && !showComments && (
              <button type="button" onClick={openComments} className="focus-ring mt-1 px-3.5 text-[13px] text-text-tertiary">
                {post.hideCommentCount && !isMine ? 'View comments' : `View ${post.commentCount === 1 ? '1 comment' : `all ${post.commentCount} comments`}`}
              </button>
            )}
          </article>
        </div>

        {showComments && (
          <CommentPanel
            comments={comments}
            postAuthorId={post.authorId}
            draft={draft}
            sending={sending}
            error={commentError}
            onDraft={setDraft}
            onSubmit={() => void submitComment()}
            onDelete={(comment) => void removeComment(comment)}
            onClose={() => setShowComments(false)}
          />
        )}

        {sharing && (
          <SharePostSheet
            post={post}
            author={author}
            onClose={() => setSharing(false)}
            onAddToStory={(audience) => onAddToStory?.(audience)}
            onNote={(text, icon) => setNote({ at: Date.now(), ok: true, text, icon })}
          />
        )}
        {note && <UploadToast key={note.at} note={note} />}
      </div>
    </Overlay>
  );
}

function MenuAction({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone?: 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'focus-ring block w-full px-4 py-3 text-left text-body',
        'transition-colors duration-instant hover:bg-hover active:bg-pressed',
        tone === 'danger' ? 'text-danger' : 'text-ink',
      )}
    >
      {label}
    </button>
  );
}

/**
 * Comments, as a sheet over the picture rather than a second screen.
 *
 * The picture stays visible above it, because a comment is about the thing you
 * are looking at and losing sight of it to read the replies is the wrong trade.
 */
function CommentPanel({
  comments,
  postAuthorId,
  draft,
  sending,
  error,
  onDraft,
  onSubmit,
  onDelete,
  onClose,
}: {
  comments: PostComment[] | undefined;
  postAuthorId: string;
  draft: string;
  sending: boolean;
  error: string | undefined;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onDelete: (comment: PostComment) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { profile } = useProfile();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col">
      <div className="absolute inset-0 -z-10 bg-backdrop/40" onPointerDown={onClose} aria-hidden />

      <div
        className={cn(
          'animate-panel-in mx-auto flex w-full max-w-xl min-h-0 flex-col bg-surface',
          'rounded-t-xl border-t border-line',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="text-h2 text-ink">Comments</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('post.hideComments')}
            className="focus-ring grid size-9 place-items-center rounded-full text-text-secondary hover:bg-hover"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {!comments ? (
            <p className="py-6 text-center text-caption text-text-tertiary">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="py-6 text-center text-caption text-text-tertiary">
              No comments yet. Say something.
            </p>
          ) : (
            <ul className="space-y-3 pb-3">
              {comments.map((comment) => {
                // The comment's author, or the post's owner. Same rule the
                // database enforces, so the button is never shown for a delete
                // that would be refused.
                const canDelete =
                  profile?.id === comment.author.id || profile?.id === postAuthorId;

                return (
                  <li key={comment.id} className="flex gap-2.5">
                    <Avatar
                      name={comment.author.displayName}
                      id={comment.author.id}
                      src={comment.author.avatarUrl}
                      size="xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-body text-ink">
                        <span className="font-medium">{comment.author.username} </span>
                        <CaptionText text={comment.body} />
                      </p>
                      <p className="mt-0.5 text-caption text-text-tertiary">
                        {new Date(comment.createdAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })}
                        {canDelete && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              onClick={() => onDelete(comment)}
                              className="focus-ring rounded-sm text-danger hover:underline"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="px-4 pb-2 text-caption text-danger">
            {error}
          </p>
        )}

        <form
          className="flex items-center gap-2 border-t border-line px-4 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            placeholder={t('post.addCommentPh')}
            aria-label={t('post.addComment')}
            maxLength={1000}
            className={cn(
              'focus-ring min-w-0 flex-1 rounded-full bg-hover px-4 py-2.5',
              'text-body text-ink placeholder:text-text-tertiary',
            )}
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label={t('post.postComment')}
            className={cn(
              'focus-ring grid size-11 shrink-0 place-items-center rounded-full',
              'bg-brand-gradient text-on-brand shadow-brand',
              'transition-transform duration-instant active:scale-95',
              (!draft.trim() || sending) && 'opacity-40',
            )}
          >
            <SendIcon size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}

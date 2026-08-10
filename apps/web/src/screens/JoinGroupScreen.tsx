import { useChat } from '@pingo/core';
import { Avatar, Button, EmptyState, LinkIcon, LoadingState, UsersIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useT } from '../features/i18n/useT.js';

/**
 * The other door into a group.
 *
 * Being *added* to a group needs a mutual follow, because it reaches into
 * somebody's app without asking. Following a link needs nothing, because the
 * consent that rule stands in for has already been given by both sides: an
 * admin made the link, and the person holding it chose to open it.
 *
 * ## It asks before it joins
 *
 * The obvious version joins on load, the link was tapped, after all. But a
 * link is a thing that gets forwarded, and arriving inside a room of strangers
 * because you tapped something in another chat is exactly the intrusion the
 * friend rule exists to prevent. So the preview comes first and the join is a
 * deliberate press.
 *
 * The preview is deliberately thin: name, picture, headcount. Not the roster
 * and not a single message: standing in the doorway is not being in the room.
 */
export function JoinGroupScreen() {
  const t = useT();
  const { code } = useParams<{ code: string }>();
  const { service } = useChat();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<
    { conversationId: string; title: string; avatarUrl?: string; memberCount: number } | undefined
  >();
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!code) return;
    let active = true;

    void service
      .previewGroupInvite(code)
      .then((found) => {
        if (!active) return;
        if (!found) {
          setState('gone');
          return;
        }
        setPreview(found);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('gone');
      });

    return () => {
      active = false;
    };
  }, [service, code]);

  const join = async () => {
    if (!code || joining) return;
    setJoining(true);
    setError(undefined);
    try {
      const conversationId = await service.joinGroupWithCode(code);
      navigate(`/chats/${conversationId}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('join.fail'));
      setJoining(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="relative flex h-full items-center justify-center bg-page">
        <BrandAir />
        <LoadingState label={t('join.checking')} />
      </div>
    );
  }

  if (state === 'gone' || !preview) {
    return (
      <div className="relative flex h-full items-center justify-center bg-page px-6">
        <BrandAir />
        <div className="relative z-10 w-full max-w-sm">
          <EmptyState
            icon={<LinkIcon size={28} />}
            title={t('join.invalid')}
            description={t('join.invalidHint')}
            action={
              <Button variant="secondary" onClick={() => navigate('/chats')}>
                {t('join.backChats')}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center bg-page px-5">
      <BrandAir />

      <div
        className={cn(
          'relative z-10 w-full max-w-sm overflow-hidden rounded-[1.75rem]',
          'border border-line/50 bg-surface/90',
          'shadow-[0_8px_40px_rgba(16,17,20,0.08),0_2px_8px_rgba(16,17,20,0.04)]',
          'backdrop-blur-md',
        )}
      >
        {/* Soft header wash behind the face */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-brand/8 to-transparent"
        />

        <div className="relative flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <span
            className={cn(
              'mb-4 inline-grid rounded-full p-1',
              'bg-page ring-1 ring-line/60',
              'shadow-[0_4px_16px_rgba(16,17,20,0.08)]',
            )}
          >
            <Avatar
              name={preview.title}
              id={preview.conversationId}
              src={preview.avatarUrl}
              size="2xl"
            />
          </span>

          <p className="mb-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-text-tertiary uppercase">
            Group invite
          </p>
          <h1 className="text-h1 tracking-[-0.02em] text-ink">{preview.title}</h1>

          <p className="mt-2 inline-flex items-center gap-1.5 text-caption text-text-secondary">
            <UsersIcon size={14} className="text-text-tertiary" />
            {preview.memberCount === 1
              ? t('join.oneMember')
              : t('join.nMembers', { n: preview.memberCount })}
          </p>

          <p className="mt-3 max-w-[16rem] text-caption leading-relaxed text-text-tertiary">
            You will join as a member. You can leave any time from group info.
          </p>

          {error && (
            <p role="alert" className="mt-3 text-caption text-danger">
              {error}
            </p>
          )}

          <div className="mt-6 flex w-full flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              className={cn(
                'w-full rounded-full',
                'transition-transform duration-[160ms] ease-standard active:scale-[0.97]',
              )}
              disabled={joining}
              onClick={() => void join()}
            >
              {joining ? t('join.joining') : t('join.join')}
            </Button>
            <button
              type="button"
              onClick={() => navigate('/chats')}
              className={cn(
                'focus-ring w-full rounded-full px-5 py-2.5',
                'text-caption font-medium text-text-tertiary',
                'transition-colors duration-[160ms] ease-standard',
                'hover:bg-hover/50 hover:text-text-secondary',
                'active:scale-[0.98]',
              )}
            >
              {t('join.notNow')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Soft brand wash — same language as notifications / premium empty states. */
function BrandAir() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-20 left-1/2 size-80 -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
      <div className="absolute bottom-16 right-[-15%] size-56 rounded-full bg-brand-alt/10 blur-3xl" />
    </div>
  );
}

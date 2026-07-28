import { useChat } from '@pingo/core';
import { Avatar, Button, EmptyState, LinkIcon, LoadingState } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

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
 * The obvious version joins on load — the link was tapped, after all. But a
 * link is a thing that gets forwarded, and arriving inside a room of strangers
 * because you tapped something in another chat is exactly the intrusion the
 * friend rule exists to prevent. So the preview comes first and the join is a
 * deliberate press.
 *
 * The preview is deliberately thin — name, picture, headcount. Not the roster
 * and not a single message: standing in the doorway is not being in the room.
 */
export function JoinGroupScreen() {
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
      setError(cause instanceof Error ? cause.message : 'That did not work.');
      setJoining(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <LoadingState label="Checking the invite" />
      </div>
    );
  }

  if (state === 'gone' || !preview) {
    return (
      <div className="flex h-full items-center justify-center bg-page px-6">
        <EmptyState
          icon={<LinkIcon size={28} />}
          title="This link is no longer valid"
          description="An admin may have revoked it. Ask them for a new one."
          action={
            <Button variant="secondary" onClick={() => navigate('/chats')}>
              Back to chats
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-page px-6 text-center">
      <Avatar
        name={preview.title}
        id={preview.conversationId}
        src={preview.avatarUrl}
        size="2xl"
      />

      <div>
        <h1 className="text-h1 text-ink">{preview.title}</h1>
        <p className="mt-1 text-body text-text-secondary">
          {preview.memberCount === 1 ? '1 member' : `${preview.memberCount} members`}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      <div className="flex w-full max-w-xs flex-col gap-2">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={joining}
          onClick={() => void join()}
        >
          {joining ? 'Joining…' : 'Join group'}
        </Button>
        <Button variant="text" className="w-full" onClick={() => navigate('/chats')}>
          Not now
        </Button>
      </div>
    </div>
  );
}

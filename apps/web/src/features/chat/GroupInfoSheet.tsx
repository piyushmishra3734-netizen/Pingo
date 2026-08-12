import { useChat, type Conversation, type User } from '@pingo/core';
import {
  Avatar,
  Button,
  CheckIcon,
  LinkIcon,
  LoadingState,
  PlusIcon,
  SearchField,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { useConfirm } from '../../components/ConfirmProvider.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { publicAppUrl } from '../../lib/public-origin.js';
import { useT } from '../i18n/useT.js';
import { useBackStep } from '../navigation/useBackStep.js';
import { useMutuals } from '../profile/useMutuals.js';

/**
 * Group info — profile of the room: cover, face, name, bio, roster, invites.
 *
 * Admins can edit the profile pieces; everyone sees the roster and can leave.
 * Invite link and add-members stay admin-only, same as before.
 */
export function GroupInfoSheet({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const t = useT();
  const { service, users, currentUser } = useChat();
  const confirm = useConfirm();
  const mutuals = useMutuals();

  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [contacts, setContacts] = useState<User[] | undefined>();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [titleDraft, setTitleDraft] = useState(conversation.title);
  const [descDraft, setDescDraft] = useState(conversation.description ?? '');
  const [avatarUrl, setAvatarUrl] = useState(conversation.avatarUrl);
  const [coverUrl, setCoverUrl] = useState(conversation.coverUrl);
  const [clearAvatar, setClearAvatar] = useState(false);
  const [clearCover, setClearCover] = useState(false);

  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const PINGO_AI_ID = 'a1000000-0000-4000-8000-0000000000a1';
  const adminIds = conversation.adminIds ?? [];
  const iAmAdmin = currentUser ? adminIds.includes(currentUser.id) : false;
  const aiInGroup = conversation.participantIds.includes(PINGO_AI_ID);
  const memberSet = useMemo(
    () => new Set(conversation.participantIds),
    [conversation.participantIds],
  );

  useEffect(() => {
    setTitleDraft(conversation.title);
    setDescDraft(conversation.description ?? '');
    setAvatarUrl(conversation.avatarUrl);
    setCoverUrl(conversation.coverUrl);
    setClearAvatar(false);
    setClearCover(false);
  }, [
    conversation.id,
    conversation.title,
    conversation.description,
    conversation.avatarUrl,
    conversation.coverUrl,
  ]);

  const members = conversation.participantIds
    .map((id) => {
      if (id === currentUser?.id) return currentUser;
      if (id === PINGO_AI_ID) {
        return (
          users.find((u) => u.id === id) ?? {
            id: PINGO_AI_ID,
            name: 'PINGO AI',
            handle: 'pingo_ai',
            presence: { state: 'online' as const, lastSeenAt: Date.now() },
          }
        );
      }
      return users.find((u) => u.id === id);
    })
    .filter((u): u is User => Boolean(u))
    .sort((a, b) => {
      const rank = Number(adminIds.includes(b.id)) - Number(adminIds.includes(a.id));
      return rank !== 0 ? rank : a.name.localeCompare(b.name);
    });

  useEffect(() => {
    if (!adding || !iAmAdmin) return;
    let active = true;
    void service
      .listContacts()
      .then((list) => {
        if (active) setContacts(list);
      })
      .catch(() => {
        if (active) setContacts([]);
      });
    return () => {
      active = false;
    };
  }, [adding, iAmAdmin, service]);

  const matches = useMemo(() => {
    if (!contacts || !mutuals) return undefined;
    const term = query.trim().toLowerCase().replace(/^@/u, '');
    return contacts
      .filter((p) => !memberSet.has(p.id))
      .filter((p) => mutuals.has(p.id))
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          p.handle.toLowerCase().includes(term),
      );
  }, [contacts, memberSet, mutuals, query]);

  const run = async (work: Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('group.fail'));
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file: File, kind: 'avatar' | 'cover') => {
    if (!currentUser) return undefined;
    const ext =
      file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : file.type === 'image/gif'
            ? 'gif'
            : 'jpg';
    const path = `${currentUser.id}/groups/${conversation.id}/${kind}-${crypto.randomUUID()}.${ext}`;
    const client = getSupabaseClient();
    const { error: upErr } = await client.storage.from('avatars').upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message || 'Upload failed');
    return client.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  };

  const onPickAvatar = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      const url = await uploadImage(file, 'avatar');
      if (!url) return;
      setAvatarUrl(url);
      setClearAvatar(false);
      await service.updateGroup(conversation.id, {
        title: titleDraft.trim() || conversation.title,
        description: descDraft,
        avatarUrl: url,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('group.fail'));
    } finally {
      setBusy(false);
    }
  };

  const onPickCover = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      const url = await uploadImage(file, 'cover');
      if (!url) return;
      setCoverUrl(url);
      setClearCover(false);
      await service.updateGroup(conversation.id, {
        title: titleDraft.trim() || conversation.title,
        description: descDraft,
        coverUrl: url,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('group.fail'));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    const title = titleDraft.trim();
    if (!title) {
      setError('A group needs a name.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await service.updateGroup(conversation.id, {
        title,
        description: descDraft,
        ...(clearAvatar
          ? { clearAvatar: true }
          : avatarUrl && avatarUrl !== conversation.avatarUrl
            ? { avatarUrl }
            : {}),
        ...(clearCover
          ? { clearCover: true }
          : coverUrl && coverUrl !== conversation.coverUrl
            ? { coverUrl }
            : {}),
      });
      setEditing(false);
      setClearAvatar(false);
      setClearCover(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('group.fail'));
    } finally {
      setBusy(false);
    }
  };

  const promote = async (person: User) => {
    const ok = await confirm({
      title: `Make ${person.name} an admin?`,
      description: 'They will be able to add and remove people, and change this group.',
      confirmLabel: t('group.makeAdmin'),
    });
    if (ok) await run(service.setGroupAdmin(conversation.id, person.id, true));
  };

  const demote = async (person: User) => {
    const ok = await confirm({
      title: `Dismiss ${person.name} as admin?`,
      description: t('group.dismissAdminHint'),
      confirmLabel: 'Dismiss',
    });
    if (ok) await run(service.setGroupAdmin(conversation.id, person.id, false));
  };

  const remove = async (person: User) => {
    const ok = await confirm({
      title: `Remove ${person.name}?`,
      description: 'They will leave the group and stop receiving messages.',
      confirmLabel: t('group.remove'),
    });
    if (ok) await run(service.removeGroupMember(conversation.id, person.id));
  };

  const leave = async () => {
    const ok = await confirm({
      title: `Leave ${conversation.title}?`,
      description: iAmAdmin
        ? 'You will stop receiving messages. If you are the last admin, the longest-standing member takes over.'
        : 'You will stop receiving messages from this group.',
      confirmLabel: 'Leave',
    });
    if (!ok) return;
    await run(service.leaveGroup(conversation.id));
    onClose();
  };

  const showLink = () =>
    void run(
      service.groupInviteCode(conversation.id).then((code) => {
        setLink(publicAppUrl(`/join/${code}`));
      }),
    );

  const copy = () => {
    if (!link) return;
    void navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => setError(t('group.copyFail')));
  };

  const revoke = async () => {
    const ok = await confirm({
      title: t('group.revokeLink'),
      description: 'Anyone still holding this link will not be able to join.',
      confirmLabel: t('group.revoke'),
    });
    if (!ok) return;
    await run(service.revokeGroupInvite(conversation.id).then(() => setLink(undefined)));
  };

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addPicked = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await service.addGroupMembers(conversation.id, [...picked]);
      setPicked(new Set());
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('group.fail'));
    } finally {
      setBusy(false);
    }
  };

  const memberLabel =
    conversation.participantIds.length === 1
      ? '1 member'
      : `${conversation.participantIds.length} members`;

  const faceSrc = clearAvatar ? undefined : avatarUrl;
  const bannerSrc = clearCover ? undefined : coverUrl;

  /*
   * Editing the group and adding people are screens inside this one, so Back
   * has to unwind them one at a time rather than throwing the whole sheet away
   * - which is what "went into the description and came back out to the chat
   * list" was. The sheet's own step is registered by `Sheet`.
   */
  useBackStep(editing, () => setEditing(false));
  useBackStep(adding, () => setAdding(false));

  return (
    <Sheet title={conversation.title} description={memberLabel} onClose={onClose} elevated>
      {error && (
        <p role="alert" className="mb-3 text-caption text-danger">
          {error}
        </p>
      )}

      {/* ---- Profile card: cover + face + name + bio -------------------- */}
      <section className="mb-5 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="relative h-28 bg-brand-wash sm:h-32">
          {bannerSrc ? (
            <img
              src={bannerSrc}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          {iAmAdmin && (
            <button
              type="button"
              disabled={busy}
              onClick={() => coverInput.current?.click()}
              className={cn(
                'absolute right-2 top-2 rounded-full px-2.5 py-1',
                'bg-black/45 text-caption font-medium text-white',
                'hover:bg-black/55 disabled:opacity-50',
              )}
            >
              {bannerSrc ? 'Change cover' : 'Add cover'}
            </button>
          )}
        </div>

        <div className="relative px-4 pb-4">
          <button
            type="button"
            disabled={!iAmAdmin || busy}
            onClick={() => iAmAdmin && avatarInput.current?.click()}
            className={cn(
              'relative -mt-10 inline-grid size-[4.5rem] place-items-center rounded-full',
              'bg-surface p-1 shadow-md ring-2 ring-surface',
              iAmAdmin && 'active:scale-[0.98]',
              (!iAmAdmin || busy) && 'cursor-default',
            )}
            aria-label={iAmAdmin ? 'Change group photo' : undefined}
          >
            <Avatar
              name={titleDraft || conversation.title}
              id={conversation.id}
              src={faceSrc}
              size="lg"
            />
          </button>

          {editing ? (
            <div className="mt-3 space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-caption text-text-tertiary">Name</span>
                <input
                  value={titleDraft}
                  maxLength={60}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className={cn(
                    'w-full rounded-xl border border-line bg-page px-3 py-2.5',
                    'text-body text-ink outline-none focus:border-brand/40',
                  )}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption text-text-tertiary">Description</span>
                <textarea
                  value={descDraft}
                  maxLength={280}
                  rows={3}
                  onChange={(e) => setDescDraft(e.target.value)}
                  placeholder="What is this group about?"
                  className={cn(
                    'w-full resize-none rounded-xl border border-line bg-page px-3 py-2.5',
                    'text-body text-ink outline-none focus:border-brand/40',
                    'placeholder:text-text-tertiary',
                  )}
                />
                <span className="mt-1 block text-right text-caption text-text-tertiary">
                  {descDraft.length}/280
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                {faceSrc && (
                  <Button
                    variant="text"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setClearAvatar(true);
                      setAvatarUrl(undefined);
                    }}
                  >
                    Remove photo
                  </Button>
                )}
                {bannerSrc && (
                  <Button
                    variant="text"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setClearCover(true);
                      setCoverUrl(undefined);
                    }}
                  >
                    Remove cover
                  </Button>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveProfile()}>
                  Save
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setTitleDraft(conversation.title);
                    setDescDraft(conversation.description ?? '');
                    setAvatarUrl(conversation.avatarUrl);
                    setCoverUrl(conversation.coverUrl);
                    setClearAvatar(false);
                    setClearCover(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <h2 className="text-h2 text-ink">{conversation.title}</h2>
              <p className="mt-0.5 text-caption text-text-tertiary">{memberLabel}</p>
              {conversation.description ? (
                <p className="mt-2 text-body text-text-secondary">{conversation.description}</p>
              ) : iAmAdmin ? (
                <p className="mt-2 text-caption text-text-tertiary">No description yet.</p>
              ) : null}
              {iAmAdmin && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  Edit group
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <input
        ref={avatarInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onPickAvatar(file);
        }}
      />
      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onPickCover(file);
        }}
      />

      {/* ---- Members ---------------------------------------------------- */}
      <h3 className="mb-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
        Members
      </h3>
      <ul className="flex flex-col">
        {members.map((person) => {
          const isAdmin = adminIds.includes(person.id);
          const isMe = person.id === currentUser?.id;

          return (
            <li key={person.id} className="flex items-center gap-3 py-2">
              <Avatar name={person.name} id={person.id} src={person.avatarUrl} size="md" />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">
                  {isMe ? 'You' : person.name}
                </span>
                <span className="block truncate text-caption text-text-tertiary">
                  {person.id === PINGO_AI_ID
                    ? 'AI · @pingoai'
                    : isAdmin
                      ? t('group.admin')
                      : `@${person.handle}`}
                </span>
              </span>

              {iAmAdmin && !isMe && (
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="text"
                    size="sm"
                    disabled={busy}
                    onClick={() => void (isAdmin ? demote(person) : promote(person))}
                  >
                    {isAdmin ? t('group.dismissAdmin') : t('group.makeAdmin')}
                  </Button>
                  <Button
                    variant="text"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove(person)}
                  >
                    {t('group.remove')}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {iAmAdmin && (
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
            PINGO AI
          </h3>
          {aiInGroup ? (
            <p className="text-caption text-text-secondary">
              PINGO AI is in this group. Anyone can type{' '}
              <span className="font-medium text-ink">@pingoai</span> and it will reply
              here. Messages that mention AI are readable by the server so it can answer
              (not end-to-end encrypted).
            </p>
          ) : (
            <>
              <p className="mb-2.5 text-caption text-text-tertiary">
                Add PINGO AI so members can @pingoai and get a reply in this chat.
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !service.addPingoAiToGroup}
                onClick={() =>
                  void run(
                    (service.addPingoAiToGroup
                      ? service.addPingoAiToGroup(conversation.id)
                      : Promise.reject(new Error('AI add is unavailable.'))
                    ).then(() => undefined),
                  )
                }
              >
                Add PINGO AI
              </Button>
            </>
          )}
        </section>
      )}

      {iAmAdmin && (
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
            Add people
          </h3>

          {adding ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-caption text-text-tertiary">{t('group.onlyFriends')}</p>
              <SearchField
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('group.searchFriends')}
                aria-label={t('group.searchFriendsAria')}
              />

              {matches === undefined ? (
                <LoadingState label={t('group.loadingFriends')} />
              ) : matches.length === 0 ? (
                <p className="py-3 text-caption text-text-tertiary">
                  {query.trim() ? t('group.nobodyMatch') : t('group.noFriendsLeft')}
                </p>
              ) : (
                <ul className="max-h-56 overflow-y-auto">
                  {matches.map((person) => {
                    const on = picked.has(person.id);
                    return (
                      <li key={person.id}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => togglePick(person.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md px-1 py-2 text-left',
                            'transition-colors duration-quick',
                            'hover:bg-surface-hover active:bg-surface-active',
                          )}
                        >
                          <Avatar
                            name={person.name}
                            id={person.id}
                            src={person.avatarUrl}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body">{person.name}</span>
                            <span className="block truncate text-caption text-text-tertiary">
                              @{person.handle}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'flex size-6 shrink-0 items-center justify-center rounded-full border',
                              'transition-colors duration-quick',
                              on
                                ? 'border-brand bg-brand text-on-brand'
                                : 'border-line text-transparent',
                            )}
                          >
                            <CheckIcon size={14} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || picked.size === 0}
                  onClick={() => void addPicked()}
                >
                  {picked.size === 0
                    ? 'Add'
                    : picked.size === 1
                      ? t('group.addOne')
                      : t('group.addN', { n: picked.size })}
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setAdding(false);
                    setPicked(new Set());
                    setQuery('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setAdding(true);
                setError(undefined);
              }}
            >
              <span className="flex items-center gap-1.5">
                <PlusIcon size={15} /> Add members
              </span>
            </Button>
          )}
        </section>
      )}

      {iAmAdmin && (
        <section className="mt-5 border-t border-line/60 pt-4">
          <h3 className="mb-2.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-text-tertiary uppercase">
            Invite link
          </h3>

          {link ? (
            <div
              className={cn(
                'rounded-2xl border border-line/50 bg-sunken/55 p-3',
                'shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]',
              )}
            >
              <p className="break-all rounded-xl bg-surface/80 px-3 py-2.5 text-caption leading-snug text-text-secondary ring-1 ring-line/40">
                {link}
              </p>
              <p className="mt-2 px-0.5 text-caption text-text-tertiary">
                Anyone with this link can join, friend or not.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={copy}
                >
                  {copied ? (
                    <span className="flex items-center gap-1.5">
                      <CheckIcon size={14} /> Copied
                    </span>
                  ) : (
                    t('group.copyLink')
                  )}
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() => void revoke()}
                >
                  {t('group.revoke')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              disabled={busy}
              onClick={showLink}
            >
              <span className="flex items-center gap-1.5">
                <LinkIcon size={15} /> {t('group.getInvite')}
              </span>
            </Button>
          )}
        </section>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <Button
          variant="text"
          className="w-full text-danger"
          disabled={busy}
          onClick={() => void leave()}
        >
          Leave group
        </Button>
      </div>
    </Sheet>
  );
}

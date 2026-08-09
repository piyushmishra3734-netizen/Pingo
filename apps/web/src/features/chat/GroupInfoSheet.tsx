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
import { useEffect, useMemo, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { useConfirm } from '../../components/ConfirmProvider.js';
import { useMutuals } from '../profile/useMutuals.js';

/**
 * Group info - who is in it, who runs it, and how to get somebody else in.
 *
 * ## Admin controls appear, they do not grey out
 *
 * A member sees the roster and the leave button and nothing else. Showing them
 * a row of disabled admin actions would be telling them about powers they do
 * not have every time they check who is in the group, which is both noise and
 * a small insult. The rule the app enforces is the rule the database enforces,
 * so nothing here is decoration.
 *
 * ## Promotion is one tap, and it is confirmed
 *
 * WhatsApp makes it one tap; this keeps that. But it also asks first, in line
 * with the rest of the app - making somebody an admin hands them the power to
 * remove you, and that is not a thing to do by brushing a list.
 *
 * ## Two doors in, not one
 *
 * Friends can be added straight from the roster (mutual follow, same rule as
 * create-group). Everyone else needs an invite link. The link is not shown
 * until it is asked for - `groupInviteCode` mints one if there is not already
 * one, so rendering it on open would create a live invite for every admin who
 * ever glanced at this sheet.
 */
export function GroupInfoSheet({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const { service, users, currentUser } = useChat();
  const confirm = useConfirm();
  const mutuals = useMutuals();

  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [contacts, setContacts] = useState<User[] | undefined>();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const adminIds = conversation.adminIds ?? [];
  const iAmAdmin = currentUser ? adminIds.includes(currentUser.id) : false;
  const memberSet = useMemo(
    () => new Set(conversation.participantIds),
    [conversation.participantIds],
  );

  /*
   * `users` does not contain you.
   *
   * It is the directory of *other* people, so resolving the roster through it
   * alone silently dropped the viewer: a group of two rendered one row and
   * called itself "1 member", and a group you had just made looked like it had
   * nobody in it but the person you added.
   */
  const members = conversation.participantIds
    .map((id) =>
      id === currentUser?.id ? currentUser : users.find((u) => u.id === id),
    )
    .filter((u): u is User => Boolean(u))
    // Admins first, then alphabetical - the people who can act on your behalf
    // are the ones you came here to find.
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

  /*
   * Friends who are not already in the group.
   *
   * Same mutual gate as create-group: the server refuses non-friends, so the
   * list must not offer them. Already-in members are dropped so the picker is
   * only people you can still act on.
   */
  const candidates = useMemo(() => {
    if (!contacts || !mutuals) return undefined;
    return contacts.filter(
      (person) => mutuals.has(person.id) && !memberSet.has(person.id),
    );
  }, [contacts, mutuals, memberSet]);

  const matches = useMemo(() => {
    if (!candidates) return undefined;
    const term = query.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter(
      (person) =>
        person.name.toLowerCase().includes(term) ||
        person.handle.toLowerCase().includes(term),
    );
  }, [candidates, query]);

  const run = async (work: Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await work;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const promote = async (person: User) => {
    const ok = await confirm({
      title: `Make ${person.name} an admin?`,
      description:
        'They will be able to add and remove people, rename the group, and make other admins.',
      confirmLabel: 'Make admin',
      tone: 'normal',
    });
    if (ok) await run(service.setGroupAdmin(conversation.id, person.id, true));
  };

  const demote = async (person: User) => {
    const ok = await confirm({
      title: `Dismiss ${person.name} as admin?`,
      description: 'They stay in the group as an ordinary member.',
      confirmLabel: 'Dismiss',
      tone: 'normal',
    });
    if (ok) await run(service.setGroupAdmin(conversation.id, person.id, false));
  };

  const remove = async (person: User) => {
    const ok = await confirm({
      title: `Remove ${person.name}?`,
      description: 'They will not be able to come back unless someone adds them or sends a link.',
      confirmLabel: 'Remove',
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
        setLink(`${window.location.origin}/join/${code}`);
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
      .catch(() => setError('Could not copy that.'));
  };

  const revoke = async () => {
    const ok = await confirm({
      title: 'Revoke this link?',
      description: 'Anyone still holding it will not be able to join. You can make a new one.',
      confirmLabel: 'Revoke',
    });
    if (!ok) return;

    await run(service.revokeGroupInvite(conversation.id));
    setLink(undefined);
  };

  const togglePick = (id: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addPicked = async () => {
    if (picked.size === 0 || busy) return;
    const ids = [...picked];
    setBusy(true);
    setError(undefined);
    try {
      await service.addGroupMembers(conversation.id, ids);
      setPicked(new Set());
      setQuery('');
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={conversation.title}
      /*
       * Counted from the roster the server sent, not from the rows that
       * resolved to a name. A member whose profile has not been fetched yet is
       * still in the group, and a headcount that quietly drops them is worse
       * than one that is briefly ahead of the list beneath it.
       */
      description={
        conversation.participantIds.length === 1
          ? '1 member'
          : `${conversation.participantIds.length} members`
      }
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="mb-3 text-caption text-danger">
          {error}
        </p>
      )}

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
                  {isAdmin ? 'Admin' : `@${person.handle}`}
                </span>
              </span>

              {/*
                Admin controls, and only for an admin. `isMe` is excluded from
                remove because leaving is a different act with different
                consequences, and it has its own button below.
              */}
              {iAmAdmin && !isMe && (
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="text"
                    size="sm"
                    disabled={busy}
                    onClick={() => void (isAdmin ? demote(person) : promote(person))}
                  >
                    {isAdmin ? 'Dismiss' : 'Make admin'}
                  </Button>
                  <Button
                    variant="text"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove(person)}
                  >
                    Remove
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
            Add people
          </h3>

          {adding ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-caption text-text-tertiary">
                Only friends can be added directly. For everyone else, use an invite link.
              </p>
              <SearchField
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search friends"
                aria-label="Search friends to add"
              />

              {matches === undefined ? (
                <LoadingState label="Loading friends" />
              ) : matches.length === 0 ? (
                <p className="py-3 text-caption text-text-tertiary">
                  {query.trim()
                    ? 'Nobody by that name among your friends outside this group.'
                    : 'No friends left to add. Share the invite link instead.'}
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
                      ? 'Add 1 person'
                      : `Add ${picked.size} people`}
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
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
            Invite link
          </h3>

          {link ? (
            <>
              <p className="mb-2.5 break-all rounded-md bg-surface-sunken px-3 py-2 text-caption text-text-secondary">
                {link}
              </p>
              <p className="mb-2.5 text-caption text-text-tertiary">
                Anyone with this link can join, friend or not.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={copy}>
                  {copied ? (
                    <span className="flex items-center gap-1.5">
                      <CheckIcon size={14} /> Copied
                    </span>
                  ) : (
                    'Copy link'
                  )}
                </Button>
                <Button variant="text" size="sm" disabled={busy} onClick={() => void revoke()}>
                  Revoke
                </Button>
              </div>
            </>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy} onClick={showLink}>
              <span className="flex items-center gap-1.5">
                <LinkIcon size={15} /> Get invite link
              </span>
            </Button>
          )}
        </section>
      )}

      <div className={cn('mt-5 border-t border-line pt-4')}>
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

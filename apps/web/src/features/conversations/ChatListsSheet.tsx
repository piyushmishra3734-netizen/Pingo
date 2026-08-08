import { useChat, type ChatList } from '@pingo/core';
import { CheckIcon, EditIcon, ListIcon, PlusIcon, TrashIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { useReturnFocus } from './focus-restore.js';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Overlay } from '../../components/Overlay.js';
import { useT } from '../i18n/useT.js';

/**
 * Filing chats into the user's own lists - "Work", "Family".
 *
 * ## Checkboxes, not a picker
 *
 * A chat belongs to as many lists as it belongs to; "Work" and "Travel" is a
 * normal thing for one conversation to be. So this is a set of toggles rather
 * than a single choice, and it shows the current state of every list rather than
 * asking you to remember it.
 *
 * ## Mixed selections
 *
 * Filing four chats where two are already in "Work" is ambiguous, and the honest
 * answer is a third state. Tapping a mixed row files *all* of them, because the
 * reason anyone opens this with a mixed selection is to make them consistent  - 
 * and the second tap unfiles all of them, so the round trip is still reachable.
 */

export interface ChatListsSheetProps {
  /**
   * The chats being filed, by id.
   *
   * Ids rather than the conversations themselves, because filing one changes
   * its `listIds` and the sheet has to see that. Handed the objects, it would
   * hold whatever they looked like when the menu was tapped, the tick would
   * never appear, even though the count beside it went up.
   */
  selectedIds: string[];
  onClose: () => void;
  /** Called after any change, so the list can refresh its chips. */
  onChanged: () => void;
}

type Membership = 'none' | 'some' | 'all';

export function ChatListsSheet({ selectedIds, onClose, onChanged }: ChatListsSheetProps) {
  const t = useT();
  const { service, conversations } = useChat();

  /** Resolved live, so a filing that lands is a tick that appears. */
  const selected = conversations.filter((c) => selectedIds.includes(c.id));
  const [lists, setLists] = useState<ChatList[]>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  /** The list whose name is being edited. Renaming is rare, so it is not a mode. */
  const [renaming, setRenaming] = useState<string>();
  const [error, setError] = useState<string>();

  const load = () => {
    void service
      .listChatLists()
      .then(setLists)
      .catch(() => setLists([]));
  };

  useEffect(load, [service]);

  useReturnFocus();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const membership = (list: ChatList): Membership => {
    const inList = selected.filter((c) => c.listIds.includes(list.id)).length;
    if (inList === 0) return 'none';
    return inList === selected.length ? 'all' : 'some';
  };

  const toggle = async (list: ChatList) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // "some" becomes "all": the point of filing a mixed selection is to make
      // it consistent, and a second tap clears it again.
      const shouldAdd = membership(list) !== 'all';
      await service.setChatListMembership(list.id, selected.map((c) => c.id), shouldAdd);
      load();
      onChanged();
    } catch {
      setError('That change did not save.');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const list = await service.createChatList(trimmed);
      // Created *and* filed. Making a list called "Work" while four chats are
      // selected and then having to tap it is a step nobody wants.
      await service.setChatListMembership(list.id, selected.map((c) => c.id), true);
      setName('');
      setCreating(false);
      load();
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error && /duplicate|unique/i.test(cause.message)
          ? 'You already have a list with that name.'
          : 'That list could not be created.',
      );
    } finally {
      setBusy(false);
    }
  };

  const rename = async (list: ChatList, next: string) => {
    const trimmed = next.trim();
    setRenaming(undefined);
    if (!trimmed || trimmed === list.name || busy) return;

    setBusy(true);
    setError(undefined);
    try {
      await service.renameChatList(list.id, trimmed);
      load();
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error && /duplicate|unique/i.test(cause.message)
          ? 'You already have a list with that name.'
          : 'That list could not be renamed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (list: ChatList) => {
    if (busy) return;

    /*
     * The chats in it are untouched, only the grouping goes. Saying so is the
     * difference between a moment's hesitation and a real fright, and it is why
     * this dialog names what survives rather than warning about what does not.
     */
    const go = await confirm({
      title: `Delete the list “${list.name}”?`,
      description: 'The chats in it stay exactly where they are. Only the list goes.',
      confirmLabel: 'Delete list',
    });
    if (!go) return;

    setBusy(true);
    try {
      await service.deleteChatList(list.id);
      load();
      onChanged();
    } catch {
      setError('That list could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay>
      <div
        className="fixed inset-0 z-500 flex items-end justify-center sm:items-center"
        onPointerDown={onClose}
      >
        <div className="absolute inset-0 bg-backdrop/[0.18] animate-fade-in" />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('lists.addTo')}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'animate-panel-in relative flex w-full max-w-sm flex-col',
            'max-h-[70vh] rounded-t-xl border border-line bg-surface shadow-lg',
            'sm:rounded-xl',
          )}
        >
          <div className="shrink-0 px-4 pt-4 pb-2">
            <h2 className="text-h2 text-ink">{t('lists.addTo')}</h2>
            <p className="mt-1 text-caption text-text-secondary">
              {selected.length === 1
                ? 'This chat can be in more than one.'
                : `${selected.length} chats. A chat can be in more than one.`}
            </p>
          </div>

          {error && (
            <p role="alert" className="mx-4 mb-2 rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger">
              {error}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {!lists ? null : lists.length === 0 && !creating ? (
              <p className="px-2 py-6 text-center text-caption text-text-tertiary">
                No lists yet. Make one below.
              </p>
            ) : (
              lists.map((list) => {
                const state = membership(list);

                /*
                 * Renaming replaces the row rather than opening a dialog. It is a
                 * small edit to a short string that is already on screen, and a
                 * modal for it would be a heavier interaction than the change.
                 */
                if (renaming === list.id) {
                  return (
                    <div key={list.id} className="flex items-center gap-2 px-2 py-2">
                      <input
                        autoFocus
                        defaultValue={list.name}
                        maxLength={40}
                        aria-label={`Rename ${list.name}`}
                        onBlur={(event) => void rename(list, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') setRenaming(undefined);
                        }}
                        className={cn(
                          'focus-ring min-w-0 flex-1 rounded-lg border border-line bg-page',
                          'px-3 py-2 text-body text-ink',
                        )}
                      />
                    </div>
                  );
                }

                return (
                  <div key={list.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                      onClick={() => void toggle(list)}
                      disabled={busy}
                      className={cn(
                        'focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5',
                        'text-left transition-colors duration-instant hover:bg-hover',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'grid size-5 shrink-0 place-items-center rounded-md border',
                          'transition-colors duration-instant',
                          state === 'all'
                            ? 'border-brand bg-brand text-white'
                            : state === 'some'
                              ? 'border-brand bg-brand/20 text-brand'
                              : 'border-line-strong',
                        )}
                      >
                        {/* A dash for mixed: a tick would claim all of them. */}
                        {state === 'all' ? (
                          <CheckIcon size={13} />
                        ) : state === 'some' ? (
                          <span className="h-0.5 w-2.5 rounded-full bg-brand" />
                        ) : null}
                      </span>

                      <ListIcon size={16} className="shrink-0 text-text-tertiary" />
                      <span className="min-w-0 flex-1 truncate text-body text-ink">
                        {list.name}
                      </span>

                      <span className="shrink-0 text-caption text-text-tertiary tabular-nums">
                        {list.count}
                      </span>
                    </button>

                    <button
                      type="button"
                      aria-label={`Rename list ${list.name}`}
                      onClick={() => setRenaming(list.id)}
                      disabled={busy}
                      className={cn(
                        'focus-ring shrink-0 rounded-lg p-2 text-text-tertiary',
                        'opacity-0 transition-opacity duration-instant',
                        'hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100',
                      )}
                    >
                      <EditIcon size={15} />
                    </button>

                    <button
                      type="button"
                      aria-label={`Delete list ${list.name}`}
                      onClick={() => void remove(list)}
                      disabled={busy}
                      className={cn(
                        'focus-ring mr-1 shrink-0 rounded-lg p-2 text-text-tertiary',
                        'opacity-0 transition-opacity duration-instant',
                        'hover:bg-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100',
                      )}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                );
              })
            )}

            {creating ? (
              <div className="flex items-center gap-2 px-2 py-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void create();
                    if (event.key === 'Escape') setCreating(false);
                  }}
                  maxLength={40}
                  placeholder={t('lists.namePlaceholder')}
                  aria-label={t('lists.newNameAria')}
                  className={cn(
                    'focus-ring min-w-0 flex-1 rounded-lg border border-line bg-page',
                    'px-3 py-2 text-body text-ink placeholder:text-text-tertiary',
                  )}
                />
                <button
                  type="button"
                  onClick={() => void create()}
                  disabled={!name.trim() || busy}
                  className={cn(
                    'focus-ring shrink-0 rounded-full bg-brand-gradient px-4 py-2',
                    'text-caption font-medium text-white disabled:opacity-50',
                  )}
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className={cn(
                  'focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2.5',
                  'text-body text-brand transition-colors duration-instant hover:bg-hover',
                )}
              >
                <span aria-hidden className="grid size-5 shrink-0 place-items-center">
                  <PlusIcon size={16} />
                </span>
                New list
              </button>
            )}
          </div>

          <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'focus-ring w-full rounded-full px-5 py-2.5 text-body',
                'text-text-secondary hover:bg-hover',
              )}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

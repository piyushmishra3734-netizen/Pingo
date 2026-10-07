import { EmptyState, Skeleton, cn } from '@pingo/ui';
import { useLocation } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { useT } from '../i18n/useT.js';

/**
 * The routes that open on a list. Copied from `#boot` in index.html, and the
 * two must agree: this is what replaces that shell once React has mounted.
 */
export const LIST_ROUTES = /^\/(chats|calls|communities|notifications|profile|settings)/;

/** Bar widths from `#boot`, row by row, so the handover from it is invisible. */
const ROWS = [
  ['55%', '80%'],
  ['45%', '70%'],
  ['62%', '60%'],
  ['48%', '76%'],
] as const;

/**
 * Every wait between the splash and the chat list, in the list's own place.
 *
 * ## What it replaced
 *
 * Three different waits sat between the splash and the list - the session
 * check (bare ground), the profile read (a skeleton in a centred 42rem column)
 * and the shell waiting for chats (`AppLoader`, a ring in the middle of the
 * window). On a phone the centre and the list are the same place, so nobody
 * noticed. On a desktop the list is a 22-25rem pane on the left, so the splash
 * faded onto a loader in the middle of an empty window, which then vanished
 * and the list appeared somewhere else entirely - a cut, twice.
 *
 * Now each of them draws this: the boot shell's column, at the width the real
 * pane has (`w-[22rem] xl:w-[25rem]`, with its edge) on a desktop and the full
 * width on a phone. On `/chats` the rest of a desktop window is the same faded
 * logo and "Pick a conversation" the real screen shows there, so when the list
 * arrives only the rows change.
 *
 * A non-list route gets the ground alone, the same as `#boot` does there.
 */
export function ListPaneSkeleton() {
  const t = useT();
  const { pathname } = useLocation();
  if (!LIST_ROUTES.test(pathname)) return <div className="h-full bg-page" aria-busy="true" />;
  // `/chats` with nothing open is the only list route with a placeholder beside it.
  const pickHint = /^\/chats\/?$/.test(pathname);

  return (
    <div className="flex h-full min-h-0 bg-page" role="status" aria-label={t('common.opening')}>
      <div
        className={cn(
          'flex h-full w-full shrink-0 flex-col gap-3.5 overflow-hidden px-4 py-5',
          'lg:w-[22rem] lg:border-r lg:border-line xl:w-[25rem]',
        )}
        aria-hidden
      >
        <Skeleton className="h-6 w-28 rounded-lg" />
        <Skeleton className="h-10 w-full rounded-[1.25rem]" />
        {ROWS.map(([title, preview], i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton circle className="size-11 shrink-0" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-[0.8rem] rounded-full" style={{ width: title }} />
              <Skeleton className="h-[0.7rem] rounded-full" style={{ width: preview }} />
            </div>
          </div>
        ))}
      </div>
      {pickHint ? (
        <div className="hidden min-w-0 flex-1 place-items-center lg:grid">
          {/* Exactly ChatsScreen's empty pane, so it is already in place when the list lands. */}
          <div className="flex flex-col items-center">
            <AppLogo size={64} alt="" className="opacity-45" />
            <EmptyState title={t('chats.pick')} description={t('chats.pickHint')} className="pt-6" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

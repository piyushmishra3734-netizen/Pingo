import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * The two things you can do to a notification after the fact.
 *
 * Both are `security definer` functions rather than table updates, because both
 * set two columns that must move together - an open implies a read, and a
 * dismissal implies both. Letting a client write them separately invites the
 * combination that makes no sense, "opened but unread", which would quietly
 * corrupt every rate computed from them.
 *
 * Failures are swallowed. Neither call changes what the person sees - the row
 * has already left the screen or the chat has already opened - and an error
 * about bookkeeping is noise about something they did not ask for.
 */

/** They tapped through. Counts as read *and* as acted on. */
export async function markOpened(ids: string[]): Promise<void> {
  const client = getSupabaseClient();
  await Promise.all(
    ids.map((id) => client.rpc('notification_opened', { target: id }).then(undefined, () => undefined)),
  );
}

/** They swiped it away. Hidden from history, not deleted - see the migration. */
export async function markDismissed(ids: string[]): Promise<void> {
  const client = getSupabaseClient();
  await Promise.all(
    ids.map((id) =>
      client.rpc('notification_dismissed', { target: id }).then(undefined, () => undefined),
    ),
  );
}

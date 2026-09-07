/*
 * The replication publication now matches what the app actually listens to.
 *
 * `supabase_realtime` carried twelve tables. The client subscribes to six:
 *
 *     conversation_members, conversations, message_reactions,
 *     messages, notifications, privacy_settings
 *
 * Every `postgres_changes` subscription in the codebase is one of those - calls
 * and typing use broadcast channels, which are not part of this at all. The
 * other six were published to nobody.
 *
 * ## What that was costing
 *
 * Realtime reads the WAL for every published table and evaluates row-level
 * security per subscriber to decide what to send. With no subscriber there is
 * nothing to send, so this is server work rather than egress - but it is work
 * done on every write, and one of these tables is written constantly:
 * `device_keys` takes a heartbeat UPDATE once a minute from every open client,
 * which is around ten thousand rows a day decoded, filtered, and discarded.
 *
 * Stating the limit honestly, because the timing invites the wrong conclusion:
 * this is not the egress fix. It was found while looking for one. The bytes
 * leaving this project over realtime are the `messages` fan-out - 3,261 bytes
 * per row, of which 47 are the message and the rest is the envelope, sent once
 * per recipient - and that is fixed by shrinking the envelope, not here.
 *
 * ## Adding one back
 *
 * A table has to be in this publication before anything can subscribe to it. If
 * a future screen wants live stories or live profiles, add the table here in
 * the same change that adds the subscription - otherwise the subscription is
 * silent and nothing says why.
 */

alter publication supabase_realtime drop table public.device_keys;
alter publication supabase_realtime drop table public.follows;
alter publication supabase_realtime drop table public.posts;
alter publication supabase_realtime drop table public.profiles;
alter publication supabase_realtime drop table public.recovery_requests;
alter publication supabase_realtime drop table public.stories;

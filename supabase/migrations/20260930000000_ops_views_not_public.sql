/*
 * Two operational views were readable by anybody with the publishable key.
 *
 * ## What was actually exposed
 *
 * `media_fully_delivered` lists, for every media message in the product, the
 * message id, the sender's user id, the conversation id and the exact storage
 * path of the file. A view carries the permissions of whoever created it unless
 * it is told otherwise, so it read `messages` as the owner and every row-level
 * policy on that table was simply not consulted. The publishable key ships in
 * the web bundle, which means the request needed no account at all:
 *
 *   GET /rest/v1/media_fully_delivered?select=*   ->  200, everybody's rows
 *
 * That is not the bytes - Storage has its own policies - but it is the map:
 * who sent a photo, into which conversation, when, and what it is called in the
 * bucket. On a private messenger that is the product's whole promise.
 *
 * `push_metrics` is only counters - deliveries, failures, average latency - so
 * it leaks operational shape rather than anybody's data. It goes the same way
 * for the same reason: neither of these was ever meant to leave the server.
 *
 * ## Why revoke rather than `security_invoker`
 *
 * Turning on invoker semantics would make the view obey the caller's policies,
 * which fixes the leak and also makes the view return nothing useful to the one
 * caller that is supposed to read it. `purge_delivered_media()` is the only
 * consumer, it is `security definer`, and it runs as the owner - so the honest
 * shape is "the server reads this, nobody else can address it at all".
 *
 * Grants, not policies: a view has no RLS of its own, and PostgREST will not
 * expose a relation the requesting role cannot select from.
 */

revoke all on public.media_fully_delivered from anon, authenticated;
revoke all on public.push_metrics from anon, authenticated;

/*
 * Note for whoever edits these views next.
 *
 * Supabase grants every new relation in `public` to `anon` and `authenticated`
 * by default, so a later `create or replace view` on either of these hands the
 * access straight back. The revoke has to be repeated in that migration.
 *
 * Deliberately not fixed with `alter default privileges ... revoke from anon`:
 * that would silently change every future table in the schema, and a blanket
 * rule set here to fix two views is the kind of thing that surfaces months
 * later as a table nobody can read for no visible reason.
 */

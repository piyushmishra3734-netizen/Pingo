/*
 * Once the device has it, PINGO stops holding it.
 *
 * ## What was actually happening
 *
 * `purge_delivered_media` has two branches. One parks media that every
 * recipient has confirmed, `media_min_retention` after the last receipt; the
 * other parks anything past `created_at + media_max_retention`. Both numbers
 * were 24 hours - and a receipt necessarily lands *after* the message was
 * created, so `delivered_at + 24h` is always later than `created_at + 24h`.
 * The ceiling always won. The delivery branch had not fired once.
 *
 * That is why media consistently died at 24.1 hours whether it had been
 * collected in the first minute or never collected at all: delivery was being
 * measured, recorded, and then ignored.
 *
 * ## The rule that was actually asked for
 *
 * The server is the transport, not the library. Its copy exists so the file can
 * reach the other person; the moment it has reached them, holding it is PINGO
 * storing somebody's photograph for no reason. So the delivered branch now runs
 * an hour after the last recipient confirms, and the 24-hour ceiling stays
 * exactly where it is for anything that never arrives.
 *
 * ## What the hour is for, and what it costs
 *
 * It is not a safety margin for the person who received it - they have the
 * file. It covers the write that has not settled yet: a receipt sent as the
 * local copy is still being flushed, a tab closed mid-save, a retry.
 *
 * The cost is real and worth stating. Receipts are per *person*, not per
 * device. Read a photo on your phone and PINGO's copy goes an hour later, so a
 * laptop opened that evening will not find it - it will say "Photo no longer
 * available", which is true. The seven-day version of this number existed to
 * cover exactly that, plus a reinstall the same afternoon restoring a device
 * from a backup older than the message.
 *
 * That trade is the point rather than an oversight: the whole instruction was
 * that the device holds the copy and the server does not. If second devices
 * start missing pictures in practice, this is one number in one function -
 * raise it to six hours and the behaviour moves with it.
 */

create or replace function public.media_min_retention()
returns interval language sql immutable as $$ select interval '1 hour' $$;

comment on function public.media_min_retention() is
  'How long PINGO keeps its copy after every recipient has confirmed theirs. Short on purpose: the server is the transport, not the library. Receipts are per person, so a second device that has not synced within this window will not get the file.';

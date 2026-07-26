-- Call signalling: who may listen on, and publish to, a call topic.
--
-- Voice calls exchange their SDP offer, answer and ICE candidates over Realtime
-- broadcast, on a topic named after the callee: `call:{user_id}`. Without these
-- policies that topic is public — anyone holding the anon key (which is every
-- visitor, by design) could subscribe to a stranger's topic and watch their call
-- setup, or publish a fake offer and make their phone ring.
--
-- Realtime Authorization closes that: a channel opened with `private: true` is
-- checked against RLS on `realtime.messages` before a single message flows.
--
--   * SELECT  — receiving. Allowed only on **your own** topic. This is the
--               policy that makes eavesdropping impossible rather than merely
--               unlikely: `realtime.topic()` is the requested topic and
--               `auth.uid()` cannot be forged.
--   * INSERT  — sending. Allowed to any `call:%` topic, because calling someone
--               is precisely the act of writing to their topic. It requires a
--               signed-in user, so a signal always comes from a real account.
--
-- The `from` field inside the payload is still self-reported. A signed-in user
-- could name someone else there; the fix is to read the sender's id from the
-- session rather than the payload, which needs a Realtime feature that does not
-- exist yet. The blast radius is a misattributed caller name, not access to
-- anyone's audio — media is peer-to-peer and never touches this channel.
--
-- Note these policies apply *only* to private channels. The chat service's
-- `postgres_changes` subscriptions are a different mechanism on public topics
-- and are unaffected by anything here.

create policy "receive on own call topic"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'call:' || auth.uid()::text
    and realtime.messages.extension = 'broadcast'
  );

create policy "send to any call topic"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'call:%'
    and realtime.messages.extension = 'broadcast'
  );

/**
 * PINGO AI reply generation.
 *
 * Browser never holds the model key. JWT proves the caller owns an `ai`
 * conversation; this function loads profile + memories + recent plaintext,
 * calls NVIDIA, posts the reply, and (when allowed) updates memory.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// Pure, and the one piece here with a right answer that can be stated - so it
// lives where it can be asserted outside Deno. See `verify:ai-reply-shape`.
import { characterPrompt } from './character.ts';
import {
  replyBudget,
  salvageTruncatedEnvelope,
  shapeReply,
  stripReasoning,
  splitIntoBubbles,
  trimEnvelopeDebris,
} from './reply-shape.ts';
import { imagePrompt } from './image-intent.ts';
import { reasoningDemand, type Demand } from './demand.ts';
import { generateImage } from './generate-image.ts';

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
const BOT_ID = 'a1000000-0000-4000-8000-0000000000a1';

/** Noise we never feed back into the model. */
const SKIP_BODIES = [
  "Something glitched on my side. Say that again?",
  "Something went wrong on my side. Say that again?",
  "I'm almost ready - my connection is still being set up. Try me again in a bit.",
  'Hmm - I blanked for a second. What were you saying?',
];

function corsHeaders(request: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Headers':
      request.headers.get('Access-Control-Request-Headers') ??
      'authorization, x-client-info, apikey, content-type, x-pingo-client',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

type AiProfile = {
  display_name?: string;
  personality?: string;
  custom_personality?: string | null;
  response_length?: string;
  preferred_name?: string | null;
  language?: string | null;
  country?: string | null;
  memory_enabled?: boolean;
  age?: number | null;
};

/** What the assistant is doing right now, in the order it happens. */
export type Stage =
  | 'remembering'
  | 'reading'
  | 'thinking'
  | 'reconsidering'
  | 'drawing'
  | 'uploading'
  | 'writing';

/** Told each time the turn moves on. A no-op when nobody is listening. */
type Emit = (stage: Stage) => void;

/**
 * One turn, start to finish.
 *
 * Was the body of `Deno.serve` directly. It is a named function now so the
 * same code can either be awaited for a single JSON reply or driven by a
 * stream that reports each stage as it is reached - the difference is one
 * argument, and neither path duplicates a line of what happens in between.
 */
async function runTurn(request: Request, emit: Emit): Promise<Response> {
  /*
   * Three numbers, so 'it is slow' can be answered instead of argued about:
   * everything before the model, the model itself, and everything after. Cheap
   * enough to leave in - three timestamps - and it is the difference between
   * tuning the right thing and tuning the nearest thing.
   */
  const t0 = Date.now();
  let tModel = 0;
  let tModelDone = 0;
  let tRetryDone = 0;
  let tPostStart = 0;
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) {
      return json(request, { error: 'Sign in required.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authorization } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return json(request, { error: 'Sign in required.' }, 401);
    }

    const body = (await request.json()) as {
      conversationId?: string;
      userMessage?: string;
      /** Group mode: only set when the bot is a member and the user @mentioned AI. */
      mode?: 'dm' | 'group';
    };
    const conversationId = body.conversationId;
    if (!conversationId) {
      return json(request, { error: 'conversationId required.' }, 400);
    }

    const { data: conv } = await userClient
      .from('conversations')
      .select('id, kind')
      .eq('id', conversationId)
      .maybeSingle();

    if (!conv) {
      return json(request, { error: 'Conversation not found.' }, 404);
    }

    const isAiDm = conv.kind === 'ai';
    const isGroup = conv.kind === 'group' || conv.kind === 'community';
    if (!isAiDm && !isGroup) {
      return json(request, { error: 'Not an AI conversation.' }, 403);
    }

    if (isGroup) {
      const { data: botMember } = await userClient
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', BOT_ID)
        .maybeSingle();
      if (!botMember) {
        return json(request, { error: 'PINGO AI is not in this group.' }, 403);
      }
      const { data: meMember } = await userClient
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!meMember) {
        return json(request, { error: 'Not a group member.' }, 403);
      }
    }

    /*
     * The thread is asked for now and read later.
     *
     * It does not depend on the profile or the memories, and it was queued
     * behind both - three round trips one after another before the model was
     * even called. Started here it overlaps with them and costs nothing.
     */
    const historyQuery = userClient
      .from('messages')
      .select('sender_id, body, created_at, encryption')
      .eq('conversation_id', conversationId)
      /*
       * Encrypted rows are not fetched at all, rather than fetched and thrown
       * away. In a group that is almost the entire thread - only messages
       * mentioning @pingoai are plaintext - so of 200 rows perhaps five
       * survived and the rest crossed the wire to be discarded.
       */
      .is('encryption', null)
      .order('created_at', { ascending: false })
      .limit(120);

    const { data: profile } = await userClient
      .from('ai_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    const memoryOn = profile?.memory_enabled !== false;
    let memories: { id?: string; key: string; value: string }[] = [];

    // ONLY save when user explicitly asks (yaad rakh / remember / memory me save).
    // Never auto-extract facts from casual chat.
    const livePreview = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';

    /*
     * A picture, when that is what was asked for.
     *
     * Placed before the profile, the memories and the history are assembled,
     * because none of them tells a diffusion model anything: the prompt is the
     * sentence the person just typed. Assembling them first would add a second
     * of latency to the one request that is already the slowest thing PINGO
     * does.
     *
     * Anything `imagePrompt` does not recognise falls through to the ordinary
     * reply path, where the model can say what it can and cannot do - which is
     * a better answer to "draw a conclusion" than a picture of one.
     */
    const drawing = imagePrompt(livePreview);
    if (drawing) {
      return await replyWithImage(request, userClient, supabaseUrl, conversationId, drawing, emit);
    }

    // Everything from here to the model call is fetching what the model needs
    // to know: who this person is, what it has been told to remember, and what
    // was just said.
    emit('reading');

    let justSaved: { key: string; value: string } | null = null;
    if (memoryOn && livePreview) {
      const forced = parseExplicitMemory(livePreview);
      if (forced) {
        try {
          emit('remembering');
          await upsertMemoryRow(userClient, user.id, forced.key, forced.value);
          justSaved = forced;
          await capMemories(userClient, user.id, 40);
        } catch (err) {
          console.error('explicit-memory', err);
        }
      }
    }

    if (memoryOn) {
      const { data } = await userClient
        .from('ai_memories')
        .select('id, key, value')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      memories = data ?? [];
    }

    // Started before the profile fetch, above.
    const { data: rows } = await historyQuery;

    const chronological = [...(rows ?? [])]
      .reverse()
      .filter(
        (row) =>
          row.encryption == null &&
          typeof row.body === 'string' &&
          row.body.trim() &&
          !SKIP_BODIES.includes(row.body.trim()) &&
          // Never feed format markers back into the model.
          !/<<<\s*(REPLY|ASK)\s*>>>/i.test(row.body),
      );

    /*
     * Who said each line, which a group cannot do without.
     *
     * Every human in the transcript was `role: 'user'` with nothing to tell
     * them apart, so in a group of six the model saw one person with six
     * personalities - and `collapseHistory` then merged consecutive lines from
     * *different* people into a single message. Asked about something Baani
     * said, it would answer with something Eddy said, because as far as it
     * could see they were the same speaker.
     *
     * One query for the names, and only in a group - a direct thread has one
     * other person and labelling their every line "Piyush:" is noise.
     */
    const speakerNames = new Map<string, string>();
    if (isGroup) {
      const senderIds = [
        ...new Set(chronological.map((r) => r.sender_id).filter((id) => id && id !== BOT_ID)),
      ];
      if (senderIds.length > 0) {
        const { data: people } = await userClient
          .from('profiles')
          .select('id, display_name, username')
          .in('id', senderIds);
        for (const p of people ?? []) {
          const name = (p.display_name ?? '').trim() || (p.username ?? '').trim();
          if (name) speakerNames.set(p.id, name);
        }
      }
    }

    const history = chronological
      .map((row) => {
        const raw = stripMarkers(row.body.trim()).slice(0, 2000);
        const role = (row.sender_id === BOT_ID ? 'assistant' : 'user') as
          | 'assistant'
          | 'user';
        // Soft-scrub spam from assistant only — keep real content for context.
        const cleaned =
          role === 'assistant' ? sanitizeHistoryAssistant(raw) : raw;

        /*
         * Named in the text, not in a field the API would drop.
         *
         * OpenAI-compatible chat completions have a `name` on a message, but
         * support for it is uneven across the models in the chain and a
         * silently ignored field is exactly the kind of thing that looks like
         * it is working. A prefix is read by every model there is.
         */
        const speaker = role === 'assistant' ? '' : (speakerNames.get(row.sender_id) ?? '');
        const content = speaker ? `${speaker}: ${cleaned}` : cleaned;
        return { role, content, speaker };
      })
      .filter(
        (m) =>
          m.content.trim().length > 0 &&
          m.content.trim() !== '(previous reply)' &&
          m.content.trim() !== '(earlier message)',
      );

    const live = body.userMessage?.trim();
    if (live) {
      const last = history[history.length - 1];
      if (!last || last.role !== 'user' || last.content !== live) {
        history.push({ role: 'user', content: live.slice(0, 2000) });
      }
    }

    // Collapse same-role streaks (e.g. dual AI bubbles) without dropping topics.
    const cleanHistory = collapseHistory(history);

    if (cleanHistory.length === 0) {
      return json(request, { error: 'Nothing to reply to.' }, 400);
    }

    const recentAssistant = cleanHistory
      .filter((m) => m.role === 'assistant')
      .slice(-12)
      .map((m) => m.content);

    const system =
      buildSystemPrompt(
        profile as AiProfile | null,
        memories,
        memoryOn,
        justSaved,
      ) +
      (isGroup
        ? [

            '',
            '## Group chat mode',
            'You are PINGO AI inside a multi-person group. Someone mentioned you with @pingoai / @pingo_ai.',
            '',
            '### Who said what',
            'Every human line in the transcript starts with that person\'s name, like "Baani: kal chalein?".',
            'That prefix is the speaker. It is not part of what they said.',
            'Keep them apart. Track what EACH person said separately - their questions, their plans, their facts.',
            'Never attribute one person\'s words, opinions or details to another. If two people said different things, they are two people.',
            'If you are unsure which of them said something, say so instead of guessing a name.',
            '',
            '### Who you are answering',
            `The person who just tagged you is ${
              speakerNames.get(user.id) ?? 'the latest speaker'
            }. Answer them, using what THEY said - and bring in what others said only when it is relevant to their question.`,
            'If they refer to something someone else said ("wo jo Eddy ne bola"), find that person\'s line and use it.',
            '',
            'Reply as yourself in the group — short, clear, helpful. Address the room, not just one private DM tone.',
            'Do not prefix your own reply with a name. You are not one of the labelled speakers.',
            'You only see plaintext lines (encrypted human-only messages may be missing). Rely on the latest @mention message.',
            'Do not claim to be a human. Do not spam long dual-bubble questions — one solid reply is enough.',
          ].join('\n')
        : '');
    const focus = buildFocusDirective(
      cleanHistory,
      profile as AiProfile | null,
      recentAssistant,
      memories,
      memoryOn,
      justSaved,
    );

    // Longer window so the model can follow multi-turn threads.
    const historyForModel = trimHistoryForModel(cleanHistory);

    const messages = [
      /*
       * Nemotron's reasoning switch, and it has to be its own first message.
       *
       * These models emit a chain of thought by default, and PINGO published
       * it: a reply that began "Here's a thinking process: 1. Analyze User
       * Input..." went into somebody's chat. It is also most of the model time -
       * measured, 8.9s to answer "theek hai bhai", nearly all of it spent
       * writing reasoning nobody would ever read.
       *
       * NVIDIA's documented control for this is a system message containing
       * exactly `detailed thinking off`. Harmless to any model that does not
       * know it - it reads as an instruction it has no reason to follow.
       */
      { role: 'system' as const, content: 'detailed thinking off' },
      { role: 'system' as const, content: system },
      ...historyForModel.slice(0, -1),
      { role: 'system' as const, content: focus },
      historyForModel[historyForModel.length - 1]!,
    ];

    const apiKey = Deno.env.get('NVIDIA_API_KEY');
    if (!apiKey) {
      const fallback =
        "I'm almost ready - my connection is still being set up. Try me again in a bit.";
      const { data: id, error } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: fallback,
      });
      if (error) return json(request, { error: error.message }, 500);
      return json(request, { messageId: id, offline: true });
    }

    const base = (Deno.env.get('NVIDIA_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '');
    /*
     * Empty means "use the chain" - see `MODEL_CHAIN`.
     *
     * It used to fall back to the 8B by name, which is why nothing ever tried
     * anything better: the default was a decision nobody had revisited.
     */
    const model = Deno.env.get('NVIDIA_MODEL') ?? '';
    const length = profile?.response_length ?? 'short';

    // Soft intent hint only — never a hard-coded answer bank for specific words.
    const intent = detectIntent(live ?? '');
    /*
     * Room to finish the sentence, not permission to ramble.
     *
     * How long a reply *should* be is set by the system prompt; this is the
     * hard ceiling, and at 280 tokens a reply that reasoned its way to an
     * answer was being cut off mid-word - which reads as the assistant losing
     * its train of thought rather than as a limit being hit. Raising the
     * ceiling does not make short replies longer, it stops them ending
     * halfway.
     */
    /*
     * What this message actually asks for, decided from the text before any
     * model is called. See `demand.ts` for why it is not another model call.
     */
    const demand = reasoningDemand(live ?? '');

    /*
     * Room to finish, and a floor for anything that had to be worked out.
     *
     * The ceiling used to come from the reply-length *preference* alone, so
     * somebody who likes short answers got 400 tokens for a proof - and the
     * model, asked to answer as JSON, ran out mid-string. That is exactly how
     * `{"reply":"Abhi tak koi complete mathematical proof…` reached a thread:
     * not a parser bug at heart, a ceiling set by the wrong question.
     *
     * Preference still decides how long a reply *should* be; this only stops it
     * being cut off in the middle of one.
     */
    const preferred = length === 'detailed' ? 1200 : length === 'balanced' ? 700 : 400;
    const maxTokens = demand === 'heavy' ? Math.max(preferred, 1200) : preferred;

    emit('thinking');
    tModel = Date.now();
    const raw1 = await callChatModel(apiKey, base, model, messages, {
      demand,
      temperature: 0.55,
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
      max_tokens: maxTokens,
    });

    tModelDone = Date.now();

    if (raw1 == null) {
      const { data: id } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: "Something went wrong on my side. Say that again? 😅",
      });
      return json(request, { messageId: id, error: 'model_failed' }, 200);
    }

    let { reply, ask } = parseModelPayload(raw1, length);
    reply = finalizeBubble(reply, length);
    ask = finalizeAsk(ask);

    // Second pass if first answer is off/vague — keep full thread context.
    /*
     * No second pass in a group.
     *
     * The retry is a whole extra model call - the single largest thing in this
     * request - and it exists to rescue a vague answer in a one-to-one chat
     * where the assistant is the only other voice. A group already gets one
     * reply by design, everybody is waiting on it in a room that is still
     * talking, and doubling the wait to sharpen a sentence is the wrong trade
     * there.
     */
    /*
     * A repeated reply is worth a second pass anywhere, including a group.
     *
     * `isTooSimilarToRecent` guarded the follow-up question and nothing else,
     * so the *reply* itself could be - and was - sent again word for word. Two
     * different messages produced near-identical answers, which is the whole of
     * "wo baar baar wahi bol raha hai".
     *
     * Vagueness is still a direct-chat-only retry: it costs a full extra model
     * call and a group is a room full of people waiting. Repeating yourself is
     * different - it is worse in a group than a delay is.
     */
    const repeated = isTooSimilarToRecent(reply, recentAssistant);

    /*
     * The retry is the most expensive thing in this request, by a distance.
     *
     * Timed on the live function, answering "ok bhai": 906ms of queries, 6.3s
     * for the model, 29ms to post - and 13.6s for the retry. Two thirds of the
     * wait, spent sharpening a reply to a message that said "ok".
     *
     * `shouldRetryAnswer` was tuned against the 8B, which produced vague
     * answers often enough to be worth a second pass. On a 30B the first answer
     * is usually the answer, so the same test now mostly buys nothing and
     * charges double for it.
     *
     * So vagueness only earns a retry when something was actually asked -
     * `replyBudget` already knows the difference, and a message it sizes at one
     * bubble is chit-chat. A repeat still earns one anywhere: sending the same
     * words twice is a defect, not a matter of polish.
     */
    const chitChat = replyBudget(live ?? '').bubbles === 1;

    if (repeated || (!isGroup && !chitChat && shouldRetryAnswer(reply, live ?? '', intent))) {
      const threadBrief = formatThreadForPrompt(historyForModel, 16, 320);
      const retryMessages = [
        {
          role: 'system' as const,
          content: buildRetrySystem(profile as AiProfile | null),
        },
        {
          role: 'user' as const,
          content: [
            'Full recent conversation (USE THIS — do not forget earlier turns):',
            threadBrief || '(none)',
            '',
            `Latest user message: """${(live ?? '').slice(0, 800)}"""`,
            '',
            'If they use ye/uska/wo/upar/pehle/that/it — resolve from the conversation above.',
            'Step 1 (silent): What do they want, given the whole thread?',
            'Step 2: Answer with that context. General knowledge OK. No vague filler.',
            ...(repeated
              ? [
                  '',
                  'IMPORTANT: your last attempt repeated something you have already said:',
                  `"""${reply.slice(0, 300)}"""`,
                  'Do not send that again, and do not send a reworded version of it.',
                  'Say something new, or say the one thing that actually answers them.',
                ]
              : []),
            'Return ONLY JSON: {"reply":"...","ask":""}',
          ].join('\n'),
        },
      ];
      emit('reconsidering');
      const raw2 = await callChatModel(apiKey, base, model, retryMessages, {
        /*
         * The retry is what happens when the first answer missed. Sending it
         * back to the same size of model is asking the question that already
         * failed - so a retry is always heavy, whatever the first pass was.
         */
        demand: 'heavy' as const,
        temperature: 0.4,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.05,
        max_tokens: maxTokens,
      });
      if (raw2) {
        const second = parseModelPayload(raw2, length);
        const r2 = finalizeBubble(second.reply, length);
        if (r2 && !shouldRetryAnswer(r2, live ?? '', intent)) {
          reply = r2;
          ask = finalizeAsk(second.ask);
        } else if (
          r2 &&
          qualityScore(r2, live ?? '') > qualityScore(reply, live ?? '')
        ) {
          reply = r2;
          ask = finalizeAsk(second.ask);
        }
      }
    }

    // Spam cleanup only — keep real answers.
    reply = diversifyReply(reply, live ?? '', recentAssistant, length, intent);
    ask = diversifyAsk(ask, live ?? '', reply, recentAssistant, intent);

    // Clear requests / greetings → one bubble (no random second question).
    if (
      /\?\s*$/.test(reply.trim()) ||
      looksLikeClearRequest(live ?? '') ||
      intent === 'greeting'
    ) {
      ask = '';
    }

    const mainBody =
      reply || smartFallbackReply(live ?? '', recentAssistant, intent);

    /*
     * Sent the way a person sends it: a few short bubbles, not one block.
     *
     * A human answering "hi, kaise ho, kya kar rahe ho" sends four messages.
     * The assistant put the same four thoughts in one paragraph, which reads
     * like a form letter in the middle of a chat - correct and joyless.
     *
     * The model already writes in lines when asked to; this posts each of them
     * as its own message, which is the only thing that makes it *look* like
     * chatting. Capped at three so a list does not become a wall of bubbles,
     * and skipped entirely on `detailed`, where somebody has explicitly asked
     * for a written answer rather than a conversation.
     */
    tRetryDone = Date.now();
    const bubbles = splitIntoBubbles(mainBody, length, live ?? '');
    emit('writing');
    tPostStart = Date.now();

    let messageId: string | null = null;
    for (const bubble of bubbles) {
      const { data: id, error: postError } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: bubble,
      });
      // The first one failing is a failure; a later one is a shorter reply,
      // and stopping there beats reporting an error over a message that sent.
      if (postError) {
        if (messageId === null) return json(request, { error: postError.message }, 500);
        break;
      }
      messageId ??= id as string;
    }

    if (messageId === null) {
      return json(request, { error: 'Nothing to send.' }, 500);
    }

    // Second bubble only in 1:1 DMs. Groups get one reply to keep noise down.
    let askId: string | null = null;
    if (
      !isGroup &&
      ask &&
      ask !== mainBody &&
      !looksLikeMarkerGarbage(ask) &&
      !isBannedAsk(ask) &&
      !containsBannedLoop(ask) &&
      !isTooSimilarToRecent(ask, recentAssistant) &&
      !isTooSimilarToRecent(ask, [mainBody])
    ) {
      const { data: followId, error: askError } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: ask,
      });
      if (!askError && followId) askId = followId as string;
    }

    // No auto memory extract — saves only happen on explicit user request (above).

    return json(request, {
      messageId,
      reply: mainBody,
      askId,
      ask,
      memorySaved: justSaved ? true : false,
      /*
       * Which model actually answered.
       *
       * The chain falls back silently, so without this there is no way to know
       * whether a reply came from the fast one at the top or the 8B at the
       * bottom - and "is it slow because of the model" is exactly the question
       * that keeps coming up. Not a secret: it is the caller's own assistant,
       * and the id is a public model name.
       */
      /*
       * The model that answered *this* turn, and the tier that chose it.
       *
       * It used to report whichever tier happened to hold a name, which is
       * unfalsifiable - it would say "120b" for a message that never went near
       * one. Routing that cannot be checked from outside is routing nobody can
       * tell is broken.
       */
      model: workingModel[demand] ?? model ?? DEFAULT_MODEL,
      demand,
      ms: {
        before: tModel - t0,
        model: tModelDone - tModel,
        retry: tRetryDone - tModelDone,
        posting: Date.now() - tPostStart,
        after: Date.now() - tModelDone,
        total: Date.now() - t0,
      },
    });
  } catch (cause) {
    console.error(cause);
    return json(
      request,
      { error: cause instanceof Error ? cause.message : 'Unexpected error' },
      500,
    );
  }
}

/**
 * The door. One turn, reported live or delivered whole.
 *
 * ## Why stream at all
 *
 * Answering can take fifteen seconds, and most of it is invisible: the model
 * call, and - when the first answer came back vague - a second complete model
 * call that costs as much again. Measured, that retry was two thirds of the
 * request. Under a single unchanging indicator all of it looks identical to
 * being stuck, which is what a person concludes.
 *
 * So the stages are sent as they happen. Not a guess made by the client from a
 * timer, which would be a story rather than a report - if the words say
 * "reconsidering" it is because a second model call is genuinely running.
 *
 * ## Server-sent events, not a websocket
 *
 * One direction, one request, dies with it. A socket would need its own
 * lifecycle to say a thing that is only true for a few seconds.
 *
 * A client that does not ask for a stream gets exactly what it got before,
 * which is what keeps this safe to deploy ahead of the app that uses it.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  /*
   * `clone()` because `runTurn` reads the body too, and a request body is a
   * stream that can only be consumed once.
   */
  const peek = await request
    .clone()
    .json()
    .catch(() => ({}) as Record<string, unknown>);

  if (!peek || (peek as { stream?: boolean }).stream !== true) {
    return runTurn(request, () => {});
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}

`));
        } catch {
          // The reader went away - the person closed the thread. Nothing to do
          // and nothing worth logging; the turn finishes on its own.
        }
      };

      try {
        const response = await runTurn(request, (stage) => send({ stage }));
        const body = await response.json().catch(() => ({}));
        send({ done: true, status: response.status, payload: body });
      } catch (cause) {
        console.error('[ai-chat] stream failed', cause);
        send({
          done: true,
          status: 500,
          payload: { error: cause instanceof Error ? cause.message : 'Unexpected error' },
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Which model answers, in order of preference.
 *
 * `NVIDIA_MODEL` still wins outright when it is set - this is only what happens
 * when nobody has said.
 *
 * The first entry is the one that makes PINGO AI able to think: an 8B model
 * follows a conversation but does not reason through one, and every complaint
 * about the assistant being shallow is that parameter count rather than the
 * prompt. The rest are here because a model id is a thing that goes away -
 * `llama-3.3-70b` is deprecated on 2026-08-25, which is a week from now - and
 * an assistant that stops answering because a name changed is worse than one
 * that answers a little less well.
 *
 * So the list is walked until one replies, ending at the 8B that has been
 * serving all along. Whichever answers is remembered for the life of the
 * instance, so the fallback is paid once rather than on every message.
 */
/*
 * Ordered by answer-per-second, not by parameter count.
 *
 * A dense 49B reasons well and takes five seconds to say "haan". The models
 * worth having here are mixture-of-experts: large enough to think, but only a
 * few billion parameters *active* per token, so they answer at close to 8B
 * speed. `qwen3-next-80b-a3b` is 80B total and 3B active - that ratio is the
 * whole reason it belongs at the top.
 *
 * These four are real: taken from `GET integrate.api.nvidia.com/v1/models`,
 * which lists without a key. The first version of this list was guessed and
 * every guess 404'd, so the dense 49B at the bottom answered everything - and
 * measured live, a three-step arithmetic question on it took fifteen seconds.
 *
 * A name that stops resolving costs one fast 404 and the chain moves on; a
 * name that resolves and is slow costs seconds on every single message. That
 * is why speed decides the order and the 8B stays at the bottom as a floor.
 */
/**
 * The big models first, for messages that need one.
 *
 * This ordering is the whole fix. The chain below is walked for availability -
 * first name that answers wins - so a single list starting at the 30B meant the
 * 120B was never reached unless the 30B was down. A question that needed
 * reasoning got the model chosen for answering "haan bhai" quickly.
 */
const HEAVY_CHAIN = [
  // 120B total, 12B active - smarter, still a fraction of a dense 49B's work.
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-nano-3-30b-a3b',
  DEFAULT_MODEL,
];

const MODEL_CHAIN = [
  /*
   * 30B total, 3B active - thinks like a 30B, answers near 8B speed.
   *
   * The plain `nano` rather than `lightning`, because NVIDIA publishes
   * `nemotron-3-nano-omni-30b-a3b-reasoning` as a separate id, which means
   * this one is the variant that does not reason out loud. `lightning` does:
   * measured, it spent seven seconds writing "Let me analyze the question
   * carefully. The user is asking..." and PINGO published it as the reply.
   */
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-nano-3-30b-a3b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  // 120B total, 12B active - smarter, still a fraction of a dense 49B's work.
  'nvidia/nemotron-3-super-120b-a12b',
  DEFAULT_MODEL,
];

/** The first model in the chain that answered, remembered per instance. */
/*
 * Remembered per tier, not once.
 *
 * A single `workingModel` was pinned by whichever call came first, and since
 * most messages are light that was always the 30B - which then answered the
 * heavy ones too, quietly undoing the routing.
 */
const workingModel: Record<Demand, string | undefined> = {
  heavy: undefined,
  light: undefined,
};

async function callChatModel(
  apiKey: string,
  base: string,
  model: string,
  messages: ChatMessage[],
  opts: {
    temperature: number;
    top_p: number;
    frequency_penalty: number;
    presence_penalty: number;
    max_tokens: number;
    /** Which chain to walk. Decided from the message, before the call. */
    demand?: Demand;
  },
): Promise<string | null> {
  const tier: Demand = opts.demand ?? 'light';
  const chain = tier === 'heavy' ? HEAVY_CHAIN : MODEL_CHAIN;
  /*
   * An explicit choice is honoured exactly; otherwise walk this tier's chain.
   *
   * `workingModel` short-circuits it after the first success, so a deployment
   * whose best model is unavailable pays for that discovery once and not on
   * every reply.
   */
  const candidates = model ? [model] : [workingModel[tier] ?? '', ...chain].filter(Boolean);

  for (const candidate of candidates) {
    const reply = await callOneModel(apiKey, base, candidate, messages, opts);
    if (reply !== null) {
      workingModel[tier] = candidate;
      return reply;
    }
    // Only worth trying the next name if there is one; the last failure is
    // reported by `callOneModel` either way.
  }
  return null;
}

async function callOneModel(
  apiKey: string,
  base: string,
  model: string,
  messages: ChatMessage[],
  opts: {
    temperature: number;
    top_p: number;
    frequency_penalty: number;
    presence_penalty: number;
    max_tokens: number;
  },
): Promise<string | null> {
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature,
        top_p: opts.top_p,
        frequency_penalty: opts.frequency_penalty,
        presence_penalty: opts.presence_penalty,
        max_tokens: opts.max_tokens,
        stream: false,
      }),
    });
    if (!res.ok) {
      console.error('nvidia', model, res.status, await res.text());
      return null;
    }
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return cleanModelArtifacts(payload.choices?.[0]?.message?.content?.trim() ?? '');
  } catch (err) {
    console.error('nvidia-call', err);
    return null;
  }
}

/** Minimal system for the retry pass — maximum comprehension, minimum rules. */
function buildRetrySystem(profile: AiProfile | null): string {
  const name = profile?.display_name?.trim() || 'PINGO';
  const lang = languageLabel(profile?.language);
  const personality = profile?.personality ?? 'friendly';
  return [
    `You are ${name}, a sharp chat friend on PINGO.`,
    'You understand ANY message: typos, Hinglish, slang, English, questions, jokes, rants, math, definitions.',
    'You have the conversation transcript — USE it. Do not forget earlier turns.',
    'If they refer to something earlier (ye/wo/uska/pehle/that), resolve it from the transcript.',
    'Figure out what they want given the whole thread, then answer usefully.',
    'Never invent memories or that they live somewhere.',
    'Never use spam openers like "Bhai full drama" or "Kya hua koi baat hai".',
    'Never reply with empty filler when they asked something clear.',
    personality === 'genz'
      ? 'Voice: Gen Z / desi chat energy, still actually answer.'
      : `Voice: ${personality}, still actually answer.`,
    lang ? `Prefer language: ${lang}` : 'Match their language.',
    'Output ONLY JSON: {"reply":"your answer","ask":""}',
  ].join('\n');
}

function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    en: 'English',
    hi: 'Hindi (Devanagari or natural Hinglish only if they wrote Hinglish — prefer clear Hindi words)',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    pt: 'Portuguese',
    ar: 'Arabic',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
  };
  return map[code.slice(0, 2).toLowerCase()] ?? code;
}

function personalityBlock(profile: AiProfile | null): string {
  // Ignore leftover custom_personality text when mode is not custom.
  const personality = profile?.personality ?? 'friendly';
  const custom =
    personality === 'custom' ? profile?.custom_personality?.trim() : undefined;

  if (personality === 'custom') {
    if (custom) {
      return [
        '## VOICE LAW (CUSTOM) — highest priority',
        `You MUST sound like this: "${custom}"`,
        'Every sentence of <<<REPLY>>> and <<<ASK>>> must match that vibe.',
        'Do not become a neutral assistant. Custom wins over all other style tips.',
      ].join('\n');
    }
    return [
      '## VOICE LAW',
      'Custom was chosen but empty — warm close-friend energy only.',
    ].join('\n');
  }

  const map: Record<string, string> = {
    friendly:
      'Warm, easy, close-friend energy. Soft check-ins. No corporate polish.',
    genz: [
      'MODE: Full Gen Z + Indian Instagram Reels / WhatsApp brainrot. You are chronically online bestie in their DMs — NOT uncle, NOT news anchor, NOT "samajh gaya / koi problem hai?".',
      'BANNED (never type these): "to samajh gaya", "koi problem hai?", "Bhai full drama hai", "Kya hua koi baat hai", "Tumne kaha tha ... maine socha tha", "Hey cutie kya hua", stiff formal Hinglish, long lectures, corporate soft voice, copy-paste loops.',
      'REQUIRED: short punchy chat. When they drop slang/memes, mirror that lane with 1–3 slang hits. Do not dump 15 slang words in one line. NEVER recycle the same opener twice in a row.',
      '',
      '## GLOBAL GEN Z / BRAINROT PACK (pick what fits):',
      'cooked / so cooked / we cooked / i\'m cooked, mid, fire, banger, W / massive W / dub, L / took an L, no cap, cap, fr / fr fr, lowkey, highkey, bet, alr / alr bet, rizz / rizzler / rizzless, delulu, ate / she ate / he ate, left no crumbs, slay, it\'s giving…, deadass, locked in / locked tf in, down bad, sus, npc, main character, aura / aura points / aura farming, based, yapping / stop yapping, say less, ratio, touch grass, hit different, ong, ngl, tbh, idk, ick / the ick, green flag, red flag, bestie, twin / twin what, be so fr, i fear, let him cook / he cooked, bombastic side eye, unhinged, goated, bed rotting, doom scroll, core / -core, aesthetic, vibes, situationship, soft launch, hard launch, bounce, ghosted, simping, crash out, spiral, me core, that girl, sigma (ironic), skibidi (joke only), ohio (ironic joke), gyatt (rare light joke), fanum tax (rare joke), 6-7 (joke), me when, the way, not me, bro really said, understood the assignment, low effort high impact, chronically online.',
      '',
      '## DESI INSTAGRAM / REELS / MEME PACK (Hinglish — match when they write desi):',
      'kuchu puchu, kuchu puchu mode, jaan hai aap, nadiya meri soni saani, nadiya ahh entry, oye hoye, arey waah, kya baat hai, full on, full on romantic, scene on / scene on hai, bhai kya scene hai, scene clear, solid / solid scene, op, sahi hai, sahi pakde hain, zero drama (ok), bakchodi band (light), pagal hai kya (light tease), dil se, cutie, jaaneman, munna/baby (only playful), thumke energy, reel wala energy, audio pe nach, story pe daal, full filmy, bollywood ahh moment, dil toot gaya fr, recovery arc, rizz with desi tadka, desi tadka, main character entry, side character energy, npc in your story, us moment, felt that, why is this so me, aaj toh mood on, thoda romance chahiye, chup chap pyar kar, rain hone de energy, it\'s giving shaadi wala vibe, soft launch energy, hard launch energy. AVOID opener spam: do not start every reply with "bhai full ...".',
      'BIG desi viral / meme energy: kacha baam / kacha baam energy (chaotic hype / unhinged hype line — playful not violent), full send, no chill, 100% real, no filter, raw, savage (light), savage but cute, vibe check, mood, same, +1, real talk, no fake, solid bhai, king/queen energy (light), massy, mass entry, hero entry, villain arc, comeback arc, plot twist, interval twist, interval banger, item song energy, dhol beats energy, garba ahh, shaadi season, rishta wala stress, ghar wale, mummy papa arc, cousin wedding arc.',
      'Cute / chaos romantic memes: kuchu puchu, jaan, jaanu, baby, suno na, ek minute, bas yahi, dil garden garden, dil garden, full crush, silent crush, notice me, main character crush, situationship wala dukh, mixed signals, green flag rare, red flag collection.',
      'If they open with kuchu puchu / nadiya / jaan hai aap / kacha baam / filmy — MATCH that exact meme lane immediately.',
      '',
      'FEW-SHOT (copy ENERGY only):',
      'User: bhai aaj full down bad hu no cap → "bro you lookin so cooked rn 😭 no cap that\'s rough" / "kya hua fr?"',
      'User: ye song fire hai ya mid? → "that\'s a W song lowkey fire 🔥 not mid" / "playlist pe daalun?"',
      'User: bro i cooked my exam fr → "YOU ATE 😭 left no crumbs fr fr" / "marks kab aayenge?"',
      'User: rizz nahi chal raha → "rizz in the mud rn 💀 aura farming fail" / "kiske pe try kiya tha?"',
      'User: kuchu puchu → "kuchu puchu mode on 😭🫶 aap toh full cutie energy" / "aur sunao jaan?"',
      'User: nadiya meri soni saani → "NAAAA 😭 nadiya meri soni saani ahh entry" / "kon trigger kiya ye audio?"',
      'User: jaan hai aap → "jaan hai aap no cap 🫶 full soft launch energy" / "ye line kiske liye thi 👀?"',
      'User: kacha baam → "KACHA BAAM 😭🔥 unhinged ahh energy unlocked" / "kiske pe feka ye?"',
      'User: aaj full form pe hu → "bhai full form pe 😭 aura farming in public" / "scene kya hai aaj?"',
      'User: dil garden garden → "dil garden garden fr 😭🌸 soft launch loading" / "kon hai crush?"',
      '',
      'Emojis: 😭 💀 🔥 ✨ 👀 🫶 💔 😂 🌸 — 1–2 max.',
      'Never invent facts. Never mean roast. Never violent. Kacha baam = hype meme only.',
    ].join('\n'),
    coach:
      'Supportive coach. Short clear next steps. No lectures. One action when possible.',
    study:
      'Patient study buddy. Explain simply. Break hard things down.',
    calm:
      'Calm, steady, unhurried. Short sentences. No hype.',
    funny:
      'Light humour and wit. Playful, never mean.',
    motivator:
      'Encouraging without toxic positivity. Honest hope.',
    creative:
      'Ideas and playful imagination. Offer options and riffs.',
    spicy:
      'Flirty, bold, teasing. Confident — never pushy or crude without invitation. Match their heat.',
  };

  return [
    '## VOICE LAW — highest priority',
    `Personality mode: ${personality}`,
    map[personality] ?? map.friendly!,
    'Stay in this mode for BOTH <<<REPLY>>> and <<<ASK>>>. Do not drift to another personality.',
  ].join('\n');
}

function lengthBlock(length: string): string {
  if (length === 'detailed') {
    return [
      '## LENGTH LAW: detailed',
      'You may write a fuller answer (still chatty). Multiple short paragraphs OK.',
      'Still not an essay or bullet dump unless they asked for steps.',
    ].join('\n');
  }
  if (length === 'balanced') {
    return [
      '## LENGTH LAW: balanced',
      'About 2–4 short chat lines in <<<REPLY>>>. Not one word. Not a paragraph wall.',
    ].join('\n');
  }
  return [
    '## LENGTH LAW: short',
    'Keep reply to 1–2 short chat lines when chatting casually.',
    'EXCEPTION: definitions, jokes, and explanations may use 2–4 lines so the answer is complete.',
    'No filler. No walls of text.',
  ].join('\n');
}

function buildSystemPrompt(
  profile: AiProfile | null,
  memories: { key: string; value: string }[],
  memoryOn = true,
  justSaved: { key: string; value: string } | null = null,
): string {
  const name = profile?.display_name?.trim() || 'PINGO';
  const length = profile?.response_length ?? 'short';
  const userName = profile?.preferred_name?.trim();
  const lang = languageLabel(profile?.language);

  let memoryBlock: string;
  if (!memoryOn) {
    memoryBlock = [
      '## Memory — OFF',
      'User disabled memory. Do not claim to save or recall long-term notes.',
      'Only use this conversation\'s recent messages.',
    ].join('\n');
  } else if (memories.length > 0) {
    memoryBlock = [
      '## Memory (READ ACCESS — only these saved notes are true long-term facts)',
      'When they ask "yaad hai?", "memory se dekh", "tujhe yaad hai", answer ONLY from this list.',
      'If something is NOT in this list: say you don\'t have that saved — do NOT invent from chat vibes.',
      'Use naturally in chat when relevant — do not dump the whole list unprompted.',
      'SAVED NOTES:',
      ...memories.map((m, i) => `${i + 1}. ${m.value}`),
      justSaved
        ? `JUST SAVED this turn (confirm briefly): "${justSaved.value}"`
        : 'SAVE RULE: only when they explicitly say yaad rakh / remember / memory me save / note kar. Never pretend you auto-saved casual chat.',
      'If they correct a fact, trust the correction for this chat.',
    ].join('\n');
  } else {
    memoryBlock = [
      '## Memory (enabled, empty list)',
      'No long-term notes saved yet.',
      'If they ask what you remember: say list is empty / kuch save nahi hai abhi.',
      justSaved
        ? `JUST SAVED this turn (confirm briefly): "${justSaved.value}"`
        : 'SAVE RULE: only when they explicitly say yaad rakh / remember / memory me save. Never auto-save.',
    ].join('\n');
  }

  return [
    `You are ${name} inside the PINGO messenger — a person in chat, not a product demo.`,
    'Not a support bot. Real chat energy. Hindi / Hinglish / English / slang / typos — you handle all of it.',
    'No markdown headings. No "As an AI…".',
    '',
    /*
     * The character, in elizaOS's shape - see `character.ts`.
     *
     * This block is the half that was missing. Everything else in this prompt
     * is rules about what to do and how long to be; none of it says who is
     * speaking or how they feel about it, and an assistant with rules and no
     * character answers like a form.
     *
     * Placed before the reasoning rules on purpose: who you are comes first,
     * and the mechanics are how that person operates.
     */
    characterPrompt(),
    '',
    '## GENERAL REASONING (works for EVERY prompt, not special keywords)',
    '1. Read the full conversation history, then the latest user message.',
    '2. Infer what they want: answer, joke, meaning, help, opinion, vent, plan, math, story, greeting, follow-up, etc.',
    '3. Satisfy that want with real content. Do not dodge with empty chat filler.',
    '4. Stay on their topic — do not answer a different imagined question.',
    '5. You have general world knowledge: define ANY word; jokes; simple reasoning.',
    '6. If the request is unclear, ask ONE clarifying question — but if it is clear, ANSWER.',
    '',
    '## CONTEXT MEMORY (critical — users complain you forget)',
    'You MUST use earlier turns in this chat. The message list above/below is the live thread.',
    'If they say ye / uska / wo / upar / pehle / wahi / that / it / "uske baare me" — resolve from prior messages.',
    'If they continue a topic (exam, crush, city, plan, joke thread) — stay on that thread.',
    'Refer back naturally: names, choices, facts they already told you this chat.',
    'Long-term Memory list = durable notes. Chat history = short-term context. Use BOTH.',
    'Never pretend the conversation just started if there are earlier messages.',
    '',
    '## BAD (never do this)',
    '- Ignoring a clear ask and saying "open karke bata" / "kya feel ho raha?"',
    '- Greeting replies like "serious ya joke?" to "hi/hlo"',
    '- Forgetting what they said 2–10 messages ago',
    '- Asking them to re-explain something already in the thread',
    '- Spam loops: "Bhai full drama", "Kya hua koi baat hai", "Tumne kaha tha… maine socha tha"',
    '',
    '## GOOD patterns',
    'Clear request → fulfill it. Casual share → specific react. Follow-up → use prior turns.',
    'Challenge / "maine kab kaha" → apologize once, no invented quote.',
    '',
    personalityBlock(profile),
    '',
    lengthBlock(length),
    '',
    lang
      ? [
          '## LANGUAGE',
          `Write reply and ask primarily in: ${lang}.`,
          'Only mix languages if they mixed first.',
        ].join('\n')
      : '## LANGUAGE\nMatch the language they write in.',
    '',
    '## Emoji',
    '1–3 natural chat emojis when it fits. No spam.',
    '',
    '## Output (JSON only)',
    '{"reply":"main answer","ask":"optional short follow-up or empty string"}',
    'No text outside JSON. Prefer ask:"" when you already fully answered.',
    '',
    '## Truth',
    '1. Answer the latest message.',
    '2. Never invent that they live somewhere or said something they did not.',
    '3. Long-term memory = Memory list only.',
    '4. Save only on explicit yaad rakh / remember.',
    '5. Do not invent relationship status from jokes.',
    '',
    userName
      ? `Call the user ${userName} when a name fits. That is the user, not the product owner.`
      : '',
    profile?.country ? `They are around ${profile.country}.` : '',
    profile?.age != null ? `Age context around ${profile.age}.` : '',
    '',
    memoryBlock,
    '',
    '## Owner (only if they explicitly ask who owns/made PINGO)',
    'piuxxh (Piyush), @piuxxh, https://pingochat.pages.dev/profile/piuxxh',
    'Otherwise never mention owner/Piyush/that link.',
    '',
    'Never claim to be human. Never claim E2EE for this chat.',
  ]
    .filter((line) => line !== undefined && line !== '')
    .join('\n');
}

function buildFocusDirective(
  history: { role: string; content: string }[],
  profile: AiProfile | null,
  recentAssistant: string[] = [],
  memories: { key: string; value: string }[] = [],
  memoryOn = true,
  justSaved: { key: string; value: string } | null = null,
): string {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const length = profile?.response_length ?? 'short';
  const lang = languageLabel(profile?.language);
  const personality = profile?.personality ?? 'friendly';
  const custom =
    personality === 'custom' ? profile?.custom_personality?.trim() : undefined;

  const voice = custom
    ? `VOICE: custom — "${custom}"`
    : `VOICE: ${personality} only (do not use other modes)`;

  const len =
    length === 'detailed'
      ? 'LENGTH: detailed OK'
      : length === 'balanced'
        ? 'LENGTH: balanced — 2–4 short lines'
        : 'LENGTH: SHORT chat lines, but never drop required context/facts';


  const avoidOpeners = recentAssistant
    .slice(-4)
    .map((t) => `- ${t.slice(0, 80)}`)
    .join('\n');

  const denial =
    /maine kab|mene kab|kab kaha|kab bola|kab kha|when did i|i never said|maine nahi|sense nhi|sense nahi|topic change/i.test(
      lastUser,
    );

  const memoryQuery =
    /yaad\s*(hai|he|hain|h?e)|remember|memory|tujhe\s+yaad|tumhe\s+yaad|kya\s+yaad|saved|profile\s*memory/i.test(
      lastUser,
    ) && !parseExplicitMemory(lastUser);

  const memoryLines =
    memoryOn && memories.length > 0
      ? memories
          .slice(0, 20)
          .map((m, i) => `${i + 1}. ${m.value}`)
          .join('\n')
      : memoryOn
        ? '(empty — nothing saved)'
        : '(memory OFF)';

  const intent = detectIntent(lastUser);
  const needsContext = refersToPriorContext(lastUser);

  return [
    /*
     * First, because everything under it is a preference and this is not.
     *
     * The directive was a stack of persona and anti-repetition rules with the
     * actual request somewhere inside it, and the model treated the request as
     * one input among many - answering the vibe and inventing its own topic
     * rather than doing the thing asked. What somebody asked for outranks how
     * they should be spoken to.
     */
    'RULE 0 — DO WHAT THEY ASKED.',
    'Read the latest message and do exactly that thing. If they asked a question, answer it.',
    'If they asked you to write, list, explain, calculate or fix something, do it now in this reply.',
    'Do not change the subject, do not invent a topic, do not tell a story they did not ask for.',
    'Every rule below is about tone and length. None of them override this one.',
    '',
    /*
     * And how it is written. Broken into lines is what makes it read as
     * chatting rather than as a letter; each line is posted as its own bubble.
     */
    'HOW MUCH — match the size of what they sent.',
    'A greeting or a one-word message gets one short line back. Not three.',
    'A real question gets a real answer, as long as it needs and no longer.',
    'Look at their message and decide the length from it. That judgement is part of the job.',
    'Say only what they asked for. If one line answers it, send one line and nothing else.',
    'No preamble. Do not restate their question. Do not say "great question" or "sure thing".',
    'Do not add extra information they did not ask for, and do not offer to do more.',
    'Do not end with a question unless you genuinely need something to answer them.',
    'A reply nobody finishes reading is a reply that failed, however correct it was.',
    '',
    'HOW TO WRITE IT — like a person typing, not like a document.',
    'Short lines. One thought per line, separated by newlines.',
    'A greeting is "hey" / "kaise ho" / "kya kar rahe the" on separate lines, not one sentence with commas.',
    'NEVER number or bullet those lines. No "1.", no "2)", no dashes. Nobody chats in a numbered list.',
    'Just the words, one per line, the way they would arrive as separate messages.',
    'No paragraphs. No "Firstly/Secondly". No markdown headings or bold.',
    'A list of numbers or facts stays together as one block - that is a list, not chatting.',
    '',
    'THIS TURN — use the whole conversation, then answer the latest line:',
    `Latest user message: """${lastUser.slice(0, 800)}"""`,
    `Soft intent hint: ${intent}`,
    needsContext
      ? 'CRITICAL: This message depends on earlier turns (ye/wo/uska/pehle/that/it…). Resolve from THREAD below. Do not ask them to repeat.'
      : 'Answer the latest want; still keep thread continuity when relevant.',
    looksLikeClearRequest(lastUser)
      ? 'Clear request — real answer, prefer ask:"".'
      : 'React specifically; use prior context if this continues a topic.',
    '',
    /*
     * The thread is not restated here any more.
     *
     * It used to be, twice: twenty turns as a transcript and sixteen more as a
     * numbered list of user lines - on top of the sixty turns already sitting
     * in the message array as real turns. The same conversation, sent three
     * times, in one request.
     *
     * That made sense for an 8B model, which needed the thread pointed at.
     * It stopped making sense the moment the model got bigger, and it became
     * the reason a two-word message took seven seconds: prefill scales with
     * the prompt, and two thirds of this prompt was a copy of the other third.
     *
     * The conversation is in the messages. This says what to do with it.
     */
    '',
    'Avoid copy-pasting these openers:',
    avoidOpeners || '(none)',
    '',
    'LONG-TERM MEMORY LIST (durable notes):',
    memoryLines,
    justSaved
      ? `User JUST asked to save: "${justSaved.value}" — confirm briefly.`
      : 'Do not claim you saved anything unless yaad rakh/remember.',
    voice,
    len,
    lang ? `LANGUAGE: write in ${lang}` : 'LANGUAGE: match user',
    'Return ONLY JSON: {"reply":"...","ask":""}',
    'Spam banned: "Bhai full drama", "Kya hua koi baat", "Tumne kaha tha", "maine socha tha tum".',
    denial
      ? 'User annoyed / topic change — brief apology if needed, then follow THEIR new topic (still remember if they refer back).'
      : memoryQuery
        ? 'Memory question — use LONG-TERM MEMORY LIST; chat history is extra context only.'
        : 'Answer with real content and continuous context.',
  ].join('\n');
}

/** Pronouns / follow-ups that require earlier turns. */
function refersToPriorContext(text: string): boolean {
  return /\b(ye|yeh|wo|woh|uska|uski|uske|unki|unke|upar|pehle|pahle|wahi|usi|us\b|that|this|it\b|them|those|earlier|before|same|wale|wali|baare\s*me|bare\s*me|ke\s*baare|phir\s*se|dobara)\b/i.test(
    text,
  ) || /^(aur|phir|fir|uske\s+baad|phir\s+se)\b/i.test(text.trim());
}

/** Compact transcript for system/retry prompts. */
function formatThreadForPrompt(
  history: { role: string; content: string }[],
  maxTurns = 14,
  maxChars = 280,
): string {
  return history
    .slice(-maxTurns)
    .map((m) => {
      const who = m.role === 'user' ? 'User' : 'You';
      const body = m.content.replace(/\s+/g, ' ').trim().slice(0, maxChars);
      return `${who}: ${body}`;
    })
    .join('\n');
}

type ChatIntent =
  | 'greeting'
  | 'joke'
  | 'define'
  | 'explain'
  | 'memory'
  | 'romance'
  | 'topic_change'
  | 'chat';

function detectIntent(lastUser: string): ChatIntent {
  const u = lastUser.trim();
  const low = u.toLowerCase();

  if (/^h+i+$|^h+e+y+$|^hlo+\b|^hello\b|^yo\b|^sup\b|^hola\b|^namaste\b|^kaise\s*ho|^kya\s*haal/i.test(low)) {
    return 'greeting';
  }
  if (
    /\bjoke\b|joke\s*suna|suna\s*(na\s+)?joke|has[aai]|funny\s*(suna|bata)|ek\s*joke|koi\s*joke/i.test(
      low,
    )
  ) {
    return 'joke';
  }
  // Definition / meaning — highest priority over romance keyword false positives.
  if (
    /\b(mtlb|matlab|meaning|means|define|definition|kya\s+hota\s+hai|ka\s+kya\s+mtlb|ka\s+kya\s+matlab|what\s+does|what\s+is\s+\w+\s*\?)/i.test(
      low,
    ) ||
    /ka\s+kya\s+(mtlb|matlab)|kya\s+(mtlb|matlab)\s+hota/i.test(low)
  ) {
    return 'define';
  }
  if (
    /\b(samjha|samjhao|explain|kaise\s+kaam|how\s+does|kyun|why\s+is|kya\s+farq)\b/i.test(low) &&
    low.length > 8
  ) {
    return 'explain';
  }
  if (
    /yaad\s*(hai|he|hain)|tujhe\s+yaad|tumhe\s+yaad|memory\s*se|kya\s+yaad|what do you remember/i.test(
      low,
    ) &&
    !parseExplicitMemory(u)
  ) {
    return 'memory';
  }
  if (/topic change|sense nahi|sense nhi|abbe\s+iss|iss baat ka kuch sense/i.test(low)) {
    return 'topic_change';
  }
  // Romance only when they state interest — not when asking "what does lowkey mean".
  if (
    /\b(propose|girlfriend|boyfriend|\bgf\b|\bbf\b|crush|meri gf|lowkey interested|i('m| am) interested)\b/i.test(
      low,
    ) &&
    !/\b(mtlb|matlab|meaning)\b/i.test(low)
  ) {
    return 'romance';
  }
  return 'chat';
}

/** Pull a term from common "what does X mean" shapes — structure-based, any word. */
function extractDefineTerm(message: string): string | null {
  const m = message.trim();
  const patterns = [
    /['"]([^'"]+)['"]\s*ka\s+kya\s+(?:mtlb|matlab)/i,
    /([A-Za-z\u0900-\u097f][\w\u0900-\u097f'-]{1,40})\s+ka\s+kya\s+(?:mtlb|matlab)/i,
    /(?:mtlb|matlab|meaning)\s+(?:of\s+)?['"]?([A-Za-z\u0900-\u097f][\w\u0900-\u097f'-]{1,40})/i,
    /what\s+does\s+['"]?([A-Za-z][\w'-]{1,40})['"]?\s+mean/i,
    /(?:kya\s+hota\s+hai)\s+['"]?([A-Za-z\u0900-\u097f][\w\u0900-\u097f'-]{1,40})/i,
    /^([A-Za-z\u0900-\u097f][\w\u0900-\u097f'-]{1,40})\s+ka\s+kya/i,
  ];
  for (const re of patterns) {
    const hit = m.match(re);
    if (hit?.[1]) return hit[1].trim();
  }
  return null;
}

/** Keep a deep enough window that multi-turn topics stay coherent. */
function trimHistoryForModel(
  history: { role: 'user' | 'assistant'; content: string }[],
): { role: 'user' | 'assistant'; content: string }[] {
  /*
   * Sized for the window the models actually have, not for the 8B.
   *
   * 28 turns was chosen against `llama-3.1-8b`, and even that has a 128K
   * window - the number was cautious rather than measured. Sixty turns of chat
   * is roughly 15K tokens with the system prompt and memories on top, which is
   * a small fraction of any model in the chain and is the difference between
   * an assistant that remembers this morning and one that remembers the last
   * ten minutes.
   *
   * The assistant's own replies were cut at 500 characters, which is the more
   * damaging half: it could read what you said in full and only a truncated
   * version of what it had answered, so anything it had explained at length
   * was gone from its own view of the conversation. Both sides get the same
   * budget now.
   */
  return history
    /*
     * Forty, not sixty.
     *
     * Sixty was chosen against the window the models have, which is enormous -
     * but prefill is paid per token on every message, and measured live a
     * two-word reply took seven seconds. Cutting the duplicated transcript out
     * of the directive took that to five; this is the other half of the same
     * problem. Forty turns is still comfortably more than the twenty-eight this
     * started at, and the difference between forty and sixty turns of chat is
     * not something anybody has ever noticed in a reply.
     */
    .slice(-40)
    .map((m) => ({
      role: m.role,
      content:
        m.role === 'assistant'
          ? sanitizeHistoryAssistant(m.content).slice(0, 1200)
          : m.content.slice(0, 1200),
    }))
    .filter(
      (m) =>
        m.content.trim().length > 0 &&
        m.content.trim() !== '(previous reply)' &&
        m.content.trim() !== '(earlier message)',
    );
}

/** Phrases users reported looping forever — ban anywhere in reply/ask. */
const BANNED_LOOP =
  /bhai\s+full(\s+(drama|topic|form|on))?|hey\s+cutie|kya\s+hua,?\s*koi\s+(baat|plan|problem)|kya\s+hoga,?\s*koi\s+(baat|plan)|aur\s+kya\s+hua|koi\s+baat\s+hai|koi\s+plan\s+hai|koi\s+problem\s+hai|bhai\s+kya\s+hua|kuch\s+to\s+bata|tumne\s+kaha\s+tha|maine\s+socha\s+tha\s+tum|yaad\s+rakh,?\s*tumne\s+kaha/i;

const BANNED_ASK =
  /kya\s+hu[ae],?\s*koi\s+(baat|plan|problem)|kya\s+hoga,?\s*koi|aur\s+kya\s+hua|koi\s+baat\s+hai|koi\s+plan\s+hai|koi\s+problem|hey\s+cutie|bhai\s+(kya\s+hua|full)|kuch\s+to\s+bata|tumne\s+kaha\s+tha/i;

const BANNED_REPLY_OPEN =
  /^(bhai\s+full|hey\s+cutie|arey,?\s*piuxxh\s+to\s+samajh|bhai\s+kya\s+hua|yaad\s+rakh,?\s*tumne)/i;

/**
 * Soft-scrub spam from past assistant bubbles.
 * Keep real answers — aggressive wiping was making the model forget the thread.
 */
/** Takes list numbering off the assistant's own past replies. See below. */
function stripOwnNumbering(text: string): string {
  const inline = (text.match(/(?:^|\s)\d{1,2}[.)]\s+\S/g) ?? []).length >= 2;
  const flat = inline ? text.replace(/\s+(\d{1,2}[.)]\s+)/g, '\n$1') : text;
  return flat
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\(?\d{1,2}[.):\]]|[-*•–])\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

function sanitizeHistoryAssistant(text: string): string {
  /*
   * Its own numbering comes off before it reads itself back.
   *
   * Numbering is stripped on the way out, but a reply written before that
   * existed is still sitting in the thread - and the model reads the thread. It
   * copies what it finds there, so one numbered reply from last week teaches it
   * to number this week's. Seen exactly that: two different messages producing
   * near-identical numbered replies, the second one plainly copied from the
   * first.
   *
   * Cleaning it here means the transcript shows the assistant talking the way
   * it is supposed to talk, whatever it actually did at the time.
   */
  let t = stripOwnNumbering(text.replace(/\r\n/g, '\n').trim());
  // Drop only pure spam lines; keep useful content lines.
  t = t
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (isBannedAsk(line) && line.length < 80) return false;
      if (/^(bhai full drama|hey cutie|kya hua,?\s*koi baat)/i.test(line)) return false;
      return true;
    })
    .join('\n');
  t = stripLoopTemplates(t);
  t = t.replace(/\s{2,}/g, ' ').trim();
  if (!t || t.length < 2) {
    return '(earlier message)';
  }
  // Soft: if still mostly banned spam, stub; otherwise keep.
  if (containsBannedLoop(t) && meaningfulLen(t) < 20) {
    return '(earlier message)';
  }
  return t.slice(0, 500);
}

function containsBannedLoop(text: string): boolean {
  return BANNED_LOOP.test(text);
}

function isBannedAsk(text: string): boolean {
  return BANNED_ASK.test(text) || containsBannedLoop(text);
}

/** Remove the exact templates from a generated string. */
function stripLoopTemplates(text: string): string {
  let t = text;
  // "Bhai full drama hai! ..." / "Bhai full topic change hai!"
  t = t.replace(/\bBhai\s+full[^.!?\n]*[.!?]?/gi, ' ');
  // "Tumne kaha tha '...' to maine socha tha ..."
  t = t.replace(/Tumne\s+kaha\s+tha[^.!?\n]*/gi, ' ');
  t = t.replace(/maine\s+socha\s+tha[^.!?\n]*/gi, ' ');
  t = t.replace(/Yaad\s+rakh,?\s*tumne\s+kaha[^.!?\n]*/gi, ' ');
  // Classic empty check-ins
  t = t.replace(
    /(Aur\s+)?[Kk]ya\s+hu[ae],?\s*koi\s+(baat|plan|problem)\s+hai\??/gi,
    ' ',
  );
  t = t.replace(/[Kk]ya\s+hoga,?\s*koi\s+(baat|plan)\s+hai\??/gi, ' ');
  t = t.replace(/[Kk]oi\s+(baat|plan|problem)\s+hai\??/gi, ' ');
  t = t.replace(/Hey\s+cutie[^.!?\n]*/gi, ' ');
  t = t.replace(/Bhai\s+kya\s+hua\??\s*Kuch\s+to\s+bata!?/gi, ' ');
  t = t.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function normalizeChat(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTooSimilarToRecent(text: string, recent: string[]): boolean {
  const norm = normalizeChat(text);
  if (!norm || norm === 'previous reply') return true;
  const words = norm.split(' ').filter(Boolean);
  return recent.some((r) => {
    const rn = normalizeChat(r);
    if (!rn || rn === 'previous reply') return false;
    if (rn === norm) return true;
    // Near-exact: one contains the other fully (only when both substantial).
    if (norm.length > 24 && rn.length > 24) {
      if (rn.includes(norm) || norm.includes(rn)) return true;
    }
    // Same first 5 content words → loop opener
    const a = words.slice(0, 5).join(' ');
    const b = rn.split(' ').slice(0, 5).join(' ');
    if (a.length > 12 && a === b) return true;
    // Very high overlap only (was 0.72 — killed legit different answers).
    const aw = new Set(words.slice(0, 14));
    const bw = new Set(rn.split(' ').slice(0, 14));
    if (aw.size < 4 || bw.size < 4) return false;
    let inter = 0;
    for (const w of aw) if (bw.has(w)) inter++;
    const union = aw.size + bw.size - inter;
    return union > 0 && inter / union >= 0.88;
  });
}

/** Vague filler we never want as the main reply when the user asked something real. */
function isVagueFiller(text: string): boolean {
  return /hmm\s+samajh\s+gaya|thoda\s+open\s+karke|kya\s+feel\s+ho\s+raha|seedha\s+usi\s+pe\s+baat|main\s+sun\s+raha\s+hoon|aage\s+kya\??\s*$|serious\s+ya\s+joke|thoda\s+detail\s+de\s+to\s+better|continue\s+kar\s*✨?\s*$/i.test(
    text,
  );
}

/** Clear ask / question / instruction — any language, not a fixed word list. */
function looksLikeClearRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[?？]/.test(t)) return true;
  // Imperatives / question / need shapes (structure-based, not a slang whitelist).
  return /\b(kya|kaise|kyun|kab|kahan|kitna|konsa|kaun|mtlb|matlab|meaning|means|define|explain|samjha|samjhao|bata|batao|suna|sunao|help|how|what|why|when|where|who|which|tell|show|give|calculate|solve|joke|story|plan|suggest|recommend|translate|yaad|chahiye|need|want|please|plz)\b/i.test(
    t,
  ) || /\d\s*[\+\-\*\/x×]\s*\d/i.test(t);
}

const STOP_WORDS = new Set(
  [
    'a','an','the','is','are','am','was','were','be','to','of','in','on','for','and','or','but',
    'i','you','me','my','your','we','they','it','this','that','with','from','as','at','by',
    'hai','hain','ho','hu','hun','hota','hoti','tha','thi','the','ka','ke','ki','ko','se','me',
    'mein','mai','main','tum','tu','aap','ye','yeh','wo','woh','bhi','to','toh','na','nahi',
    'no','yes','haan','ji','ya','aur','kya','hi','ek','do','ab','phir','bas','sirf','only',
    'please','plz','yaar','bhai','bro','hey','hi','hello','hlo','ok','okay','acha','accha',
  ],
);

function contentWords(text: string): string[] {
  return normalizeChat(text)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Soft off-topic detector — general, not trained on specific slang.
 * A clear request with a short vague reply and zero content overlap → retry.
 */
function isLikelyOffTopic(reply: string, user: string): boolean {
  if (!reply || isVagueFiller(reply)) return true;
  if (!looksLikeClearRequest(user)) return false;
  // Math / numeric answers
  if (/\d/.test(reply) && /(\d|kitna|calculate|solve|\+|\-|hota)/i.test(user)) return false;
  // Joke requests — punchlines rarely reuse the word "joke"
  if (/\bjoke\b|hasao|funny\s*(suna|bata)|suna\s*joke/i.test(user) && meaningfulLen(reply) >= 16) {
    return false;
  }
  const uw = contentWords(user);
  const rw = contentWords(reply);
  if (uw.length === 0) return false;
  const hit = uw.some(
    (w) =>
      rw.includes(w) ||
      rw.some((r) => r.includes(w) || w.includes(r)) ||
      normalizeChat(reply).includes(w),
  );
  if (hit) return false;
  // Substantive answer may use synonyms (still OK).
  if (meaningfulLen(reply) >= 40 && !isVagueFiller(reply)) return false;
  return true;
}

function shouldRetryAnswer(
  reply: string,
  user: string,
  _intent: ChatIntent,
): boolean {
  const trimmed = reply.trim();
  if (!trimmed || (meaningfulLen(trimmed) < 3 && !/\d/.test(trimmed))) return true;
  if (containsBannedLoop(reply) || BANNED_REPLY_OPEN.test(reply)) return true;
  // Vague filler is never a good final answer — retry for any message shape.
  if (isVagueFiller(reply)) return true;
  if (isLikelyOffTopic(reply, user)) return true;
  // Forgot thread: user pointed at prior context, model asked them to re-explain.
  if (
    refersToPriorContext(user) &&
    /\b(dobara|phir se bata|kiske baare|kaunsi baat|which (one|thing)|remind me what|clear nahi|kya bol rahe|kis cheez|what do you mean)\b/i.test(
      reply,
    )
  ) {
    return true;
  }
  return false;
}

/** Higher is better — used to pick between first and retry replies. */
function qualityScore(reply: string, user: string): number {
  if (!reply) return 0;
  let s = Math.min(40, meaningfulLen(reply));
  if (isVagueFiller(reply)) s -= 30;
  if (containsBannedLoop(reply)) s -= 40;
  if (isLikelyOffTopic(reply, user)) s -= 20;
  const uw = contentWords(user);
  const rn = normalizeChat(reply);
  for (const w of uw) if (rn.includes(w)) s += 6;
  if (looksLikeClearRequest(user) && meaningfulLen(reply) >= 20) s += 8;
  return s;
}

/** User message echoed back as the whole reply. */
function isEchoOfUser(reply: string, lastUser: string): boolean {
  const a = normalizeChat(reply);
  const b = normalizeChat(lastUser);
  if (!a || !b || b.length < 6) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // First line of reply is just the user line repeated
  const firstLine = normalizeChat(reply.split('\n')[0] ?? '');
  return firstLine.length > 8 && (firstLine === b || b.includes(firstLine));
}

function meaningfulLen(text: string): number {
  return normalizeChat(text).replace(/\s+/g, '').length;
}

function diversifyReply(
  reply: string,
  lastUser: string,
  recent: string[],
  length: string,
  intent: ChatIntent = 'chat',
): string {
  const original = reply.trim();
  let r = stripLoopTemplates(original);

  // Drop a first line that only echoes the user.
  if (isEchoOfUser(r, lastUser)) {
    const lines = r.split('\n').map((l) => l.trim()).filter(Boolean);
    r = lines.slice(1).join('\n').trim();
  }

  // If stripping nuked most of the reply, treat as spam → smart fallback.
  const strippedTooHard =
    meaningfulLen(original) > 20 &&
    meaningfulLen(r) < Math.min(12, meaningfulLen(original) * 0.35);

  // Only kill true spam / empty / wrong-intent filler — keep real model answers.
  const spam =
    !r ||
    meaningfulLen(r) < 4 ||
    strippedTooHard ||
    BANNED_REPLY_OPEN.test(r) ||
    containsBannedLoop(r) ||
    isEchoOfUser(r, lastUser);

  const missesIntent =
    (intent === 'joke' || intent === 'define' || intent === 'explain') &&
    (isVagueFiller(r) || missesIntentCheck(r, intent, lastUser));

  // Exact-duplicate of last assistant only (not soft jaccard — that killed good answers).
  const exactDup = recent.some((x) => normalizeChat(x) === normalizeChat(r));

  if (spam || missesIntent || exactDup) {
    r = smartFallbackReply(lastUser, recent, intent);
  }

  r = stripLoopTemplates(r);
  if (
    !r ||
    meaningfulLen(r) < 4 ||
    containsBannedLoop(r) ||
    (isVagueFiller(r) && intent !== 'chat')
  ) {
    r = smartFallbackReply(lastUser, recent, intent);
  }

  // Definitions / jokes need more than the ultra-short bubble cap.
  const shapeLen =
    intent === 'define' || intent === 'joke' || intent === 'explain'
      ? length === 'short'
        ? 'balanced'
        : length
      : length;
  return shapeReply(r, shapeLen);
}

/** Structural miss — clear request got filler / off-topic fluff. */
function missesIntentCheck(reply: string, intent: ChatIntent, lastUser: string): boolean {
  if (isVagueFiller(reply)) return true;
  if (looksLikeClearRequest(lastUser) && isLikelyOffTopic(reply, lastUser)) return true;
  if (intent === 'greeting' && /serious\s+ya\s+joke|koi\s+baat\s+hai/i.test(reply)) return true;
  return false;
}

function diversifyAsk(
  ask: string,
  lastUser: string,
  reply: string,
  recent: string[],
  intent: ChatIntent = 'chat',
): string {
  // No second bubble for clear Q&A / greetings.
  if (
    intent === 'define' ||
    intent === 'joke' ||
    intent === 'greeting' ||
    intent === 'explain'
  ) {
    return '';
  }

  let a = stripLoopTemplates(ask.trim());
  if (
    !a ||
    isBannedAsk(a) ||
    containsBannedLoop(a) ||
    isTooSimilarToRecent(a, recent) ||
    isTooSimilarToRecent(a, [reply]) ||
    isEchoOfUser(a, lastUser) ||
    isVagueFiller(a)
  ) {
    // Prefer skip over spam second bubble.
    return '';
  }
  return shapeAsk(a);
}

function pickUnused(pool: string[], recent: string[], seed: string): string {
  const used = recent.map(normalizeChat);
  const fresh = pool.filter((p) => {
    const n = normalizeChat(p);
    return !used.some((u) => u.includes(n) || n.includes(u.slice(0, 20)));
  });
  const list = fresh.length ? fresh : pool;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % list.length;
  // Also rotate by recent length so consecutive turns differ.
  return list[(h + recent.length) % list.length]!;
}

/**
 * Absolute last resort after two model passes failed.
 * Structural only — no hard-coded answers for specific slang words.
 */
function smartFallbackReply(
  lastUser: string,
  recent: string[] = [],
  intent: ChatIntent = detectIntent(lastUser),
): string {
  if (intent === 'greeting' || /^(hlo+|hi+|hey+|hello|yo|sup)\b/i.test(lastUser.trim())) {
    return pickUnused(
      ['Heyyy ✨ kya scene hai aaj?', 'Yo 👋 kya chal raha?', 'Hello hello — mood kaisa hai?'],
      recent,
      lastUser,
    );
  }

  if (intent === 'memory') {
    return 'Jo memory list me clear save hai wahi bolunga — invent nahi karunga 🫶';
  }

  if (intent === 'topic_change') {
    return 'Theek hai, reset 🔄 naya topic bol — pehle wala loop chhod diya.';
  }

  if (looksLikeClearRequest(lastUser)) {
    const term = extractDefineTerm(lastUser);
    if (term) {
      // Do not invent a fake definition dictionary — ask for context so any word works.
      return `"${term}" ka matlab usually context se clear hota hai — ek example sentence bhej, usi pe exact sense bataunga 😊`;
    }
    const clipped = lastUser.trim().slice(0, 90);
    return `Ispe seedha try: "${clipped}" — main clear answer dena chahta hoon. Ek line me thoda specific kar do?`;
  }

  return pickUnused(
    [
      'Okay 👀 bol, main sun raha hoon.',
      'Hmm, continue — kya scene hai uske baad?',
      'Gotchu — aage kya?',
    ],
    recent,
    lastUser,
  );
}

function contextualFallbackReply(lastUser: string, recent: string[] = []): string {
  return smartFallbackReply(lastUser, recent);
}

function contextualFallbackAsk(lastUser: string, recent: string[] = []): string {
  const u = lastUser.toLowerCase();
  if (/propose|girlfriend|gf|interested|crush/i.test(u)) {
    return pickUnused(
      ['Serious mode ya just testing me? 👀', 'Matlab ab kya expect kar rahe ho?', 'Joke tha ya real feel?'],
      recent,
      lastUser,
    );
  }
  if (/topic change|sense nahi|sense nhi/i.test(u)) {
    return pickUnused(
      ['Naya topic kya rakhna hai?', 'Kis cheez pe shift karein?', 'Mood kya chahiye ab?'],
      recent,
      lastUser,
    );
  }
  if (/weather|mausam|mosaam|mhow/i.test(u)) {
    return pickUnused(
      ['Kis city ka mausam actually chahiye?', 'Aaj ghumne ka mood hai kya?'],
      recent,
      lastUser,
    );
  }
  if (/exam/i.test(u)) {
    return pickUnused(
      ['Kaunsa paper next hai?', 'Kitne din bache hain?'],
      recent,
      lastUser,
    );
  }
  if (/hlo|hello|hi\b|hey\b/i.test(u)) {
    return pickUnused(
      ['Aaj ka highlight kya tha?', 'Kya plan hai aaj ka?'],
      recent,
      lastUser,
    );
  }
  if (/talent|think abt me|about me/i.test(u)) {
    return pickUnused(
      ['Ek cheez bata jo tujhe khud pasand hai?', 'Sabse underrated skill kya hai teri?'],
      recent,
      lastUser,
    );
  }
  return pickUnused(
    [
      'Uske baad kya scene?',
      'Serious ya meme mode?',
      'Aur detail de thoda?',
      'Kaise feel ho raha ab?',
      'Kiske saath related hai ye?',
      'Phir kya hua?',
      'Tu kya soch raha ispe?',
    ],
    recent,
    lastUser,
  );
}

/**
 * Prefer JSON {"reply","ask"}; fall back to marker split / last-question split.
 */
function parseModelPayload(
  raw: string,
  length: string,
): { reply: string; ask: string } {
  /*
   * The working-out comes off before anything is parsed.
   *
   * A model narrating its plan wraps everything after it, so a trace left in
   * place makes the envelope unfindable and the marker split land in the
   * wrong place. Stripping first means every branch below sees only an answer.
   */
  const text = stripReasoning(raw.replace(/\r\n/g, '\n').trim());

  // 1) JSON object
  const jsonHit = tryParseReplyJson(text);
  if (jsonHit) {
    return {
      reply: shapeReply(stripMarkers(jsonHit.reply), length) || 'Hmm 😅',
      ask: shapeAsk(stripMarkers(jsonHit.ask)),
    };
  }

  // 2) Marker format (legacy / misbehaving models)
  let normalized = text
    .replace(/<{1,3}\s*REPLY\s*>{1,3}/gi, '<<<REPLY>>>')
    .replace(/<{1,3}\s*ASK\s*>{1,3}/gi, '<<<ASK>>>')
    /*
     * The bare words, on their own line.
     *
     * A model asked for `<<<REPLY>>>` will sometimes write the label plainly
     * instead - "Reply" on one line, the answer, then "Ask" - and only the
     * angle-bracket form was recognised. The label then survived every strip
     * and shipped as part of the message: the chat list read "PINGO: Reply
     * Chetan: 8 Aam…". Anchored to its own line so a reply that genuinely
     * begins "Reply karo bhai" is untouched.
     */
    .replace(/^[ \t]*REPLY[ \t]*:?[ \t]*$/gim, '<<<REPLY>>>')
    .replace(/^[ \t]*ASK[ \t]*:?[ \t]*$/gim, '<<<ASK>>>');

  if (/<<<\s*ASK\s*>>>/i.test(normalized)) {
    let head = normalized;
    if (/<<<\s*REPLY\s*>>>/i.test(normalized)) {
      head = normalized.split(/<<<\s*REPLY\s*>>>/i)[1] ?? normalized;
    }
    const parts = head.split(/<<<\s*ASK\s*>>>/i);
    return {
      reply: shapeReply(stripMarkers((parts[0] ?? '').trim()), length) || 'Hmm 😅',
      ask: shapeAsk(stripMarkers((parts[1] ?? '').trim())),
    };
  }

  // 3) Last line question
  const lines = stripMarkers(text).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const last = lines[lines.length - 1]!;
    if (/[?？]\s*$/.test(last) || /^(what|why|how|kab|kya|kaise|aur|wanna|want)\b/i.test(last)) {
      return {
        reply: shapeReply(lines.slice(0, -1).join('\n'), length),
        ask: shapeAsk(last),
      };
    }
  }

  /*
   * Last line of defence. Anything still shaped like an envelope here is one
   * the parser could not open, and shipping it raw is the bug this whole path
   * exists to stop.
   */
  const rescued = salvageTruncatedEnvelope(text);
  if (rescued) {
    return { reply: shapeReply(stripMarkers(rescued), length) || 'Hmm 😅', ask: '' };
  }

  return {
    reply: shapeReply(stripMarkers(text), length),
    /*
     * No invented follow-up.
     *
     * When the model produced no question, the app made one up - "Aur bata?
     * 😊" - so every single reply ended with a second bubble asking something
     * nobody wanted answered. That is a message a person did not send and does
     * not read, appended to every message the assistant ever sent.
     *
     * A real follow-up from the model still goes out. This is only the case
     * where there wasn't one.
     */
    ask: '',
  };
}

function tryParseReplyJson(text: string): { reply: string; ask: string } | null {
  try {
    // Extract first {...} block if model added prose.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      reply?: unknown;
      ask?: unknown;
      message?: unknown;
      question?: unknown;
    };
    const reply = String(obj.reply ?? obj.message ?? '').trim();
    const ask = String(obj.ask ?? obj.question ?? '').trim();
    if (!reply && !ask) return null;
    return { reply, ask };
  } catch {
    /*
     * Unparseable is the common failure, not a rare one: the model runs out of
     * tokens mid-string and never writes the closing brace. Returning null here
     * is what posted `{"reply":"Abhi tak koi complete mathematical proof…` into
     * somebody's chat.
     */
    const salvaged = salvageTruncatedEnvelope(text);
    return salvaged ? { reply: salvaged, ask: '' } : null;
  }
}

function stripMarkers(text: string): string {
  // `trimEnvelopeDebris` last, because the marker strips above can themselves
  // expose a trailing quote that was previously buried mid-string.
  return trimEnvelopeDebris(
    text
      .replace(/<<<\s*REPLY\s*>>>/gi, '')
      .replace(/<<<\s*ASK\s*>>>/gi, '')
      .replace(/<{1,3}\s*REPLY\s*>{1,3}/gi, '')
      .replace(/<{1,3}\s*ASK\s*>{1,3}/gi, '')
      .replace(/\bREPLY\s*:/gi, '')
      .replace(/\bASK\s*:/gi, '')
      // The bare label on its own line - see the note in the splitter.
      .replace(/^[ \t]*(REPLY|ASK)[ \t]*$/gim, '')
      .trim(),
  );
}

function looksLikeMarkerGarbage(text: string): boolean {
  return /<<<|>>>|^\s*REPLY\s*$|^\s*ASK\s*$/i.test(text);
}

function finalizeBubble(text: string, length: string): string {
  let t = stripMarkers(cleanModelArtifacts(text));
  // If markers somehow survived mid-string, cut at ASK.
  const cut = t.split(/<<<\s*ASK\s*>>>|<{1,3}\s*ASK\s*>{1,3}/i)[0] ?? t;
  t = shapeReply(cut.trim(), length);
  return t;
}

function finalizeAsk(text: string): string {
  return shapeAsk(stripMarkers(text));
}

function shapeAsk(text: string): string {
  let ask = stripMarkers(text.replace(/\r\n/g, '\n').trim());
  ask = ask.split('\n').filter(Boolean)[0] ?? ask;
  ask = ask.replace(/^["']|["']$/g, '').trim();
  ask = stripLoopTemplates(ask);
  if (!ask || looksLikeMarkerGarbage(ask) || isBannedAsk(ask)) return '';
  if (ask.length > 120) ask = `${ask.slice(0, 117).trim()}…`;
  if (!/[?？]\s*$/.test(ask) && !/^(and you|aur|kya|what|how|wanna)/i.test(ask)) {
    ask = `${ask.replace(/[.!]+$/, '')}?`;
  }
  // Final ban gate after punctuation add.
  if (isBannedAsk(ask) || containsBannedLoop(ask)) return '';
  return ask;
}

/**
 * Merges a run of messages from the same speaker into one turn.
 *
 * The same *speaker*, not merely the same role. Every human in a group is
 * `role: 'user'`, so merging on role alone glued Baani's line to Eddy's reply
 * to it and handed the model one message containing both - which is precisely
 * how it came to attribute one person's words to another. A direct chat is
 * unaffected: there is only one other person, so role and speaker say the same
 * thing.
 */
function collapseHistory(
  history: { role: 'user' | 'assistant'; content: string; speaker?: string }[],
): { role: 'user' | 'assistant'; content: string; speaker?: string }[] {
  const out: { role: 'user' | 'assistant'; content: string; speaker?: string }[] = [];
  for (const msg of history) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role && (prev.speaker ?? '') === (msg.speaker ?? '')) {
      // Merge dual bubbles / rapid same-role sends; keep both bodies for context.
      prev.content = `${prev.content}\n${msg.content}`.slice(0, 4000);
    } else {
      out.push({ ...msg });
    }
  }
  // Cap after merge — still deep enough for multi-topic chats.
  return out.slice(-60);
}

function cleanModelArtifacts(text: string): string {
  return text
    /*
     * Reasoning that leaked into the answer.
     *
     * `detailed thinking off` handles this at the source, but a switch a model
     * may or may not honour is not something to publish somebody's chat on. A
     * `<think>` block, or a preamble announcing a thinking process, is never
     * the reply - and if the whole output turns out to be thinking, better to
     * send nothing here and let the fallback speak than to send the notes.
     */
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    /*
     * A reply that starts by narrating what it is about to do is thinking, not
     * an answer, and the whole thing goes. Matched on openers rather than on
     * content because thinking always announces itself - "let me analyze",
     * "the user is asking" - and an actual reply to a person never does.
     */
    .replace(
      /^\s*(here'?s (a|my) (thinking|thought) process|thinking process|let me (think|analyz|work|break|see|check)|reasoning|the user (is )?(ask|say|want)|first,? (i|let)|step 1)\b[\s\S]*$/i,
      '',
    )
    /*
     * Its own label, if it copied the transcript's format.
     *
     * Group history labels every human line with a speaker, and a model shown
     * "Baani: ..." lines will sometimes answer "PINGO: ...". Only its own names
     * are stripped - taking off any leading `Word:` would eat "Answer: 18",
     * which is the shape of exactly the replies worth keeping.
     */
    .replace(/^\s*(pingo(\s*ai)?|assistant)\s*:\s*/i, '')
    .replace(/^\s*(as an ai|as a language model|i'm an ai)[^\n]*\n?/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}


/**
 * Explicit save only — never match questions like "yaad hai?" / "kya yaad hai".
 * "yaad rakh blue is my fav" / "remember my dog is max" / "memory me save …"
 */
function parseExplicitMemory(message: string): { key: string; value: string } | null {
  const m = message.trim();
  // Queries — not saves.
  if (
    /^(kya\s+)?(tujhe|tumhe|tumko|aapko)?\s*yaad\s*(hai|he|hain)\b/i.test(m) ||
    /\b(yaad\s*(hai|he)|what do you remember|do you remember)\b/i.test(m) &&
      !/\b(rakh|save|note|daal|dal)\b/i.test(m)
  ) {
    return null;
  }

  const patterns = [
    /(?:please\s+)?(?:remember|save|note)\s+(?:that\s+|this\s*:?\s*)?(.+)/i,
    /(?:please\s+)?(?:remember|save)\s+this[:\s]+(.+)/i,
    /(?:yaad|yad)\s*rakh(?:na|o|e|lena|lo)?\s*(?:ki|ke|:)?\s*(.+)/i,
    /(?:mujhe\s+)?yaad\s+(?:rakh|kar)(?:na|o|e|lena|lo)?\s*(?:ki|ke|:)?\s*(.+)/i,
    /memory\s*(?:me|mein|m)?\s*(?:save|daal|dal|rakh|note)\s*(?:kar|lo|do|dena)?\s*(?:ki|ke|:)?\s*(.+)/i,
    /(?:note|save)\s*(?:kar|karo|kar\s*lo|kar\s*dena)\s*(?:ki|ke|:)?\s*(.+)/i,
    /mat\s+bhool(?:na|o)\s*(?:ki|ke|:)?\s*(.+)/i,
  ];
  for (const re of patterns) {
    const hit = m.match(re);
    if (!hit?.[1]) continue;
    let value = hit[1].trim().replace(/[.!]+$/, '').slice(0, 500);
    // Strip trailing filler
    value = value.replace(/\s*(please|plz|yaar|bhai)\s*$/i, '').trim();
    if (value.length < 2) continue;
    // Reject pure questions with no fact payload
    if (/^(kya|what|who|when|where|how)\b/i.test(value) && value.length < 12) continue;
    const key =
      value
        .toLowerCase()
        .replace(/[^a-z0-9\u0900-\u097f\s]/gi, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join('_')
        .slice(0, 40) || 'note';
    return { key: `note_${key}`.slice(0, 80), value };
  }
  return null;
}

async function upsertMemoryRow(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  const k = key.slice(0, 80);
  const v = value.slice(0, 500);
  const { data: existing } = await userClient
    .from('ai_memories')
    .select('id')
    .eq('user_id', userId)
    .eq('key', k)
    .maybeSingle();
  if (existing?.id) {
    await userClient.from('ai_memories').update({ value: v }).eq('id', existing.id);
  } else {
    await userClient.from('ai_memories').insert({ user_id: userId, key: k, value: v });
  }
}

/** Soft cap — drop oldest when over limit. */
async function capMemories(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  max = 40,
): Promise<void> {
  const { data: all } = await userClient
    .from('ai_memories')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (all && all.length > max) {
    const drop = all.slice(0, all.length - max).map((r) => r.id);
    await userClient.from('ai_memories').delete().in('id', drop);
  }
}

/**
 * Draw what was asked for, put it in the thread, and say so if it fails.
 *
 * ## Three things happen and any of them can fail
 *
 * The provider draws it, the object goes into the bucket, and a row points at
 * the object. They fail differently and a person should be told something
 * different each time - "PINGO cannot draw yet" and "that took too long" are
 * not the same news, and neither is worth a stack trace in somebody's chat.
 *
 * ## The bytes are cleaned up if the row never happens
 *
 * An upload that succeeds followed by an insert that does not leaves an object
 * nothing points at, which is precisely the orphan `media_uploads` exists to
 * catch for people - and the bot has no client to run that sweep. So it is
 * removed here, immediately, while the path is still in a variable.
 *
 * ## No special retention
 *
 * The picture is an ordinary photo message. The insert trigger stamps it, the
 * sweeper collects it 24 hours later, and the copy on the recipient's device is
 * the one that lasts. A generated image is not more precious than a sent one.
 */
async function replyWithImage(
  request: Request,
  userClient: ReturnType<typeof createClient>,
  supabaseUrl: string,
  conversationId: string,
  prompt: string,
  emit: Emit,
): Promise<Response> {
  /** Said in the thread, so it is written to be read rather than logged. */
  const say = async (body: string, status = 200, extra: Record<string, unknown> = {}) => {
    const { data: id } = await userClient.rpc('post_ai_reply', {
      target_conversation: conversationId,
      reply_body: body,
    });
    return json(request, { messageId: id, ...extra }, status);
  };

  let image;
  try {
    emit('drawing');
    image = await generateImage(prompt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[ai-chat] image generation failed', reason);

    // A missing token and a rejected one are the same news to whoever asked:
    // nothing they typed is wrong and nothing they can do will fix it.
    if (reason === 'not-configured' || reason === 'bad-token') {
      return say("I can't draw yet - my image setup isn't finished. Ask me again soon.", 200, {
        error: 'image_not_configured',
      });
    }
    // `AbortSignal.timeout` throws a TimeoutError; everything else is the
    // provider having a bad day, and neither is the asker's fault.
    /*
     * Out of credits reads as a broken prompt unless it is said plainly. The
     * provider returns 402 and a sentence; neither is the asker's fault and
     * neither is fixed by describing the picture differently.
     */
    if (/credit|quota|402|billing|payment required/i.test(reason)) {
      return say("I'm out of drawing credits right now - nothing to do with what you asked. Try me later.", 200, {
        error: 'image_no_credits',
      });
    }
    if (reason === 'blocked-prompt') {
      return say(
        "The image filter blocked that one - it's touchy, and it isn't a judgement on you. Try wording it differently?",
        200,
        { error: 'image_blocked' },
      );
    }
    if (/abort|timeout/i.test(reason)) {
      return say('That one took too long to draw. Try me again?', 200, { error: 'image_timeout' });
    }
    return say("I couldn't draw that one. Want to try describing it differently?", 200, {
      error: 'image_failed',
    });
  }

  /*
   * Service role, and only for this.
   *
   * Storage lets nobody but an uploader write to their own folder, and the bot
   * has no session to be that uploader. This is the one credential that can
   * put an object under the bot's prefix, it is used for exactly that, and
   * `post_ai_photo` still runs as the caller so membership is decided by the
   * same rules as every other message.
   */
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  emit('uploading');
  const path = `${BOT_ID}/${crypto.randomUUID()}.${image.extension}`;
  const { error: uploadError } = await admin.storage
    .from('photos')
    .upload(path, image.bytes, { contentType: image.contentType, upsert: false });

  if (uploadError) {
    console.error('[ai-chat] image upload failed', uploadError.message);
    return say("I drew it but couldn't send it. Try again?", 200, { error: 'image_upload_failed' });
  }

  const { data: messageId, error: postError } = await userClient.rpc('post_ai_photo', {
    target_conversation: conversationId,
    photo_path: path,
    caption: prompt,
  });

  if (postError) {
    console.error('[ai-chat] image post failed', postError.message);
    // The row is what makes the object reachable, so without one the bytes are
    // unreferenced from the moment they land. Removed now rather than left for
    // a sweeper that has no rule that would ever match them.
    await admin.storage.from('photos').remove([path]);
    return say("I drew it but couldn't send it. Try again?", 200, { error: 'image_post_failed' });
  }

  return json(request, { messageId, image: true, prompt });
}

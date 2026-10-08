// @ts-nocheck - a test with hand-made fakes for fetch and the database.
/**
 * PINGO AI on OpenAI (Luna): `supabase/functions/ai-chat/luna.ts` and
 * `openai.ts`, run for real against a fake OpenAI stream and a fake database.
 *
 * What it holds to: an ordinary message is ONE request and sends no memories;
 * a question about something remembered spends one tool round and gets the
 * memory; "yaad rakh ..." is saved with no extra request; the streamed pieces
 * add up to the posted reply; and a model that refuses an optional parameter
 * is asked again without it.
 */
import { lunaTurn } from '../../../supabase/functions/ai-chat/luna.ts';
import { streamChat } from '../../../supabase/functions/ai-chat/openai.ts';
import assert from 'node:assert/strict';

// ---- fake OpenAI: first call asks for recall_memory, second streams the answer
const calls = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  const sse = (chunks) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ch)}\n\n`)); c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } }), { status: 200 });
  const lastUser = body.messages.filter((m) => m.role === 'user').pop().content;
  const hasTool = body.messages.some((m) => m.role === 'tool');
  if (lastUser.includes('birthday') && !hasTool) {
    return sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'recall_memory', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"birth' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'day"}' } }] }, finish_reason: 'tool_calls' }] },
    ]);
  }
  const words = (hasTool ? 'Tera birthday 5 June hai. Party kab hai?' : 'Haan bhai, bilkul! Bata kya scene hai.').split(/(?<= )/);
  return sse([...words.map((w) => ({ choices: [{ delta: { content: w } }] })), { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 20 } }]);
};

// ---- fake db
function makeDb(state) {
  const q = (table) => {
    const ctx = { table, filters: {} };
    const api = {
      select: () => api, eq: (k, v) => ((ctx.filters[k] = v), api), is: () => api, in: () => api, lt: () => api, or: () => api,
      order: () => api, limit: (n) => ((ctx.limit = n), api),
      maybeSingle: async () => ({ data: state[table]?.[0] ?? null }),
      then: (res) => res({ data: table === 'messages' ? state.messages.slice(0, ctx.limit) : state[table] ?? [] }),
      update: () => ({ eq: async () => ({}) }),
      insert: async (row) => { state.inserted.push({ table, row }); return {}; },
      delete: () => ({ in: async () => ({}) }),
    };
    return api;
  };
  return { from: q, rpc: async (fn, args) => { state.posted.push(args.reply_body); return { data: 'msg-1', error: null }; } };
}
const deps = {
  personalityBlock: () => 'VOICE: friendly', lengthBlock: () => 'LENGTH: short', languageLabel: () => null,
  parseExplicitMemory: (m) => (/yaad rakh (.+)/i.exec(m) ? { key: 'note_x', value: /yaad rakh (.+)/i.exec(m)[1] } : null),
  upsertMemoryRow: async (db, uid, k, v) => { db.__state.saved.push(v); }, capMemories: async () => {},
  stripMarkers: (t) => t, collapseHistory: (h) => h, skipBodies: [], botId: 'BOT',
};
async function run(live, extra = {}) {
  const state = { ai_profiles: [{ memory_enabled: true, preferred_name: 'Piyush', response_length: 'short' }], ai_memories: [{ value: 'birthday 5 June', created_at: '2026-10-01T00:00:00Z' }],
    messages: [{ sender_id: 'me', body: live, created_at: '2026-10-08T10:00:01Z' }, { sender_id: 'BOT', body: 'Yo!', created_at: '2026-10-08T10:00:00Z' }, { sender_id: 'me', body: 'hi', created_at: '2026-10-08T09:59:59Z' }],
    inserted: [], posted: [], saved: [] };
  const db = makeDb(state); db.__state = state;
  const deltas = [], stages = [];
  const out = await lunaTurn({ db, userId: 'me', conversationId: 'c', isGroup: false, live, spoken: false, apiKey: 'k', base: 'https://x', model: 'gpt-6-luna', reasoningEffort: 'low', emit: (s) => stages.push(s), emitSentence: () => {}, emitDelta: (d) => deltas.push(d), ...extra }, deps);
  return { out, state, deltas, stages };
}

calls.length = 0;
let r = await run('kal movie chalein?');
assert.equal(r.out.status, 200);
assert.equal(calls.length, 1, 'plain turn = one request');
assert.equal(r.state.posted[0], 'Haan bhai, bilkul! Bata kya scene hai.');
assert.ok(r.deltas.length >= 1 && r.deltas.join('') === r.state.posted[0], 'deltas add up to the reply');
assert.ok(!JSON.stringify(calls[0].messages).includes('birthday 5 June'), 'memories not sent unless asked');
const userMsgs = calls[0].messages.filter((m) => m.role === 'user');
assert.equal(userMsgs.filter((m) => m.content === 'kal movie chalein?').length, 1, 'live message not duplicated');
assert.equal(calls[0].messages[0].role, 'system'); assert.equal(calls[0].reasoning_effort, 'low'); assert.equal(calls[0].stream, true);
console.log('plain turn ok, stages', r.stages.join('>'));

calls.length = 0;
r = await run('mera birthday kab hai?');
assert.equal(calls.length, 2, 'memory question = tool round + answer');
assert.ok(JSON.stringify(calls[1].messages).includes('birthday 5 June'), 'recalled memory given to model');
assert.equal(r.state.posted[0], 'Tera birthday 5 June hai. Party kab hai?');
console.log('recall turn ok, toolRounds', r.out.body.toolRounds);

calls.length = 0;
r = await run('yaad rakh mera fav colour blue hai');
assert.deepEqual(r.state.saved, ['mera fav colour blue hai']);
assert.equal(calls.length, 1);
assert.ok(JSON.stringify(calls[0].messages).includes('You just saved this'), 'model told it was saved');
console.log('save fast-path ok');

{
  const seen = [];
  globalThis.fetch = async (u, init) => {
    const b = JSON.parse(init.body); seen.push(b);
    if (b.reasoning_effort) return new Response('{"error":{"message":"Unsupported parameter: reasoning_effort"}}', { status: 400 });
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }));
  };
  const out = await streamChat({ apiKey: 'k', base: 'https://x', model: 'm', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'none', maxTokens: 50 });
  assert.equal(out.text, 'ok'); assert.equal(seen.length, 2); assert.equal(seen[1].reasoning_effort, undefined);
  console.log('optional-parameter fallback ok');
}
console.log('ALL OK');

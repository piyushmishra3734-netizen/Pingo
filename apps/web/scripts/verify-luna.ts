// @ts-nocheck - a test with hand-made fakes for fetch and the database.
/**
 * PINGO AI on OpenAI (Luna): `supabase/functions/ai-chat/luna.ts` and
 * `openai.ts`, run for real against a fake OpenAI Responses stream and a fake
 * database.
 *
 * What it holds to: an ordinary message is ONE request and sends no memories;
 * a question about something remembered spends one tool round and gets the
 * memory; "yaad rakh ..." is saved with no extra request; the streamed pieces
 * add up to the posted reply; a web search posts its sources with the reply; a
 * drawn picture is posted as a photo; a photo just sent goes in as an image;
 * and a model that refuses an optional parameter or a tool is asked again
 * without it.
 */
import { lunaTurn } from '../../../supabase/functions/ai-chat/luna.ts';
import { streamResponse } from '../../../supabase/functions/ai-chat/openai.ts';
import assert from 'node:assert/strict';

const enc = new TextEncoder();
const sse = (events) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    }),
    { status: 200 },
  );
const textEvents = (text, extra = []) => [
  ...extra,
  ...text.split(/(?<= )/).map((delta) => ({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta })),
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] } },
  { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20 } } },
];
const lastUserText = (body) => {
  const m = body.input.filter((x) => x.role === 'user').pop();
  return typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'input_text').map((p) => p.text).join(' ');
};

// ---- fake OpenAI
const calls = [];
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).endsWith('/responses'), 'Responses API');
  const body = JSON.parse(init.body);
  calls.push(body);
  const said = lastUserText(body);
  const answered = body.input.some((m) => m.type === 'function_call_output');
  if (said.includes('birthday') && !answered) {
    return sse([
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'sealed' } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'c1', name: 'recall_memory', arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_1', delta: '{"query":"birth' },
      { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_1', delta: 'day"}' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'c1', name: 'recall_memory', arguments: '{"query":"birthday"}' } },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
  }
  if (said.includes('score')) {
    const text = 'India won by 6 wickets ([espn.com](https://www.espn.com/m/1?utm_source=openai)).';
    return sse([
      { type: 'response.web_search_call.searching', output_index: 0, item_id: 'ws_1' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'ws_1', status: 'completed' } },
      { type: 'response.output_text.delta', item_id: 'msg_2', output_index: 1, content_index: 0, delta: text },
      { type: 'response.output_text.annotation.added', item_id: 'msg_2', output_index: 1, content_index: 0, annotation_index: 0, annotation: { type: 'url_citation', title: 'IND v AUS', url: 'https://www.espn.com/m/1?utm_source=openai', start_index: 23, end_index: 80 } },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
  }
  if (said.includes('cat ki photo')) {
    return sse([
      { type: 'response.image_generation_call.generating', output_index: 0, item_id: 'ig_1' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: btoa('WEBPBYTES'), output_format: 'webp', revised_prompt: 'A cat' } },
      { type: 'response.output_text.delta', item_id: 'msg_3', output_index: 1, content_index: 0, delta: 'Ye lo!' },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
  }
  if (said.includes('bhej rohit')) {
    const done = body.input.filter((m) => m.type === 'function_call_output').length;
    const call = (id, name, args) => sse([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: '' } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args) } },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
    if (done === 0) return call('m1', 'find_chat', { name: 'Rohit' });
    if (done === 1) return call('m2', 'schedule_message', { conversation_id: 'c0000000-0000-0000-0000-000000000001', text: 'Happy birthday!', send_at: '' });
    return sse(textEvents('Proposal ready, tap Approve. [[mood:happy]]'));
  }
  if (said.includes('bhej ghost')) return sse(textEvents('Proposal ready, tap Approve in the app. [[mood:happy]]'));
  if (said.includes('mood test')) return sse(textEvents('Wah, kya baat hai! [[mood:excited]]'));
  if (said.includes('tennis') && !said.includes('goal')) return sse(textEvents('Start with a good racket and a coach. [[mood:happy]] [[title:Learning tennis basics]]'));
  if (said.includes('goal') && !answered) {
    return sse([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_g', call_id: 'g1', name: 'add_goal', arguments: '' } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_g', call_id: 'g1', name: 'add_goal', arguments: '{"title":"Learn tennis"}' } },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
  }
  if (said.includes('goal') && answered) return sse(textEvents('Added it to your goals. [[mood:excited]]'));
  return sse(textEvents(answered ? 'Tera birthday 5 June hai. Party kab hai?' : 'Haan bhai, bilkul! Bata kya scene hai.'));
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
  return {
    from: q,
    rpc: async (fn, args) => {
      state.rpcs.push({ fn, args });
      if (fn === 'master_find_chat') return { data: [{ conversation_id: 'c0000000-0000-0000-0000-000000000001', kind: 'direct', title: 'Rohit Verma' }], error: null };
      if (fn === 'master_propose') return { data: { id: 'aaaaaaaa-1111-4111-8111-111111111111' }, error: null };
      state.posted.push(args.reply_body);
      return { data: 'msg-1', error: null };
    },
    storage: { from: (bucket) => ({ createSignedUrl: async (path) => ({ data: { signedUrl: `https://store/${bucket}/${path}?token=t` }, error: null }) }) },
  };
}
const deps = {
  personalityBlock: () => 'VOICE: friendly', lengthBlock: () => 'LENGTH: short', languageLabel: () => null,
  parseExplicitMemory: (m) => (/yaad rakh (.+)/i.exec(m) ? { key: 'note_x', value: /yaad rakh (.+)/i.exec(m)[1] } : null),
  upsertMemoryRow: async (db, uid, k, v) => { db.__state.saved.push(v); }, capMemories: async () => {},
  stripMarkers: (t) => t, collapseHistory: (h) => h, skipBodies: [], botId: 'BOT',
  imagePrompt: (t) => (/photo banao|draw/i.test(t) ? t : undefined),
  postImage: async (image, caption, meta) => { deps.__images.push({ image, caption, meta }); return { messageId: 'img-1', path: 'BOT/x.webp' }; },
  __images: [],
};
const nowIso = () => new Date().toISOString();
async function run(live, extra = {}, rows, more = {}) {
  const state = { ...more, ai_profiles: more.ai_profiles ?? [{ memory_enabled: true, preferred_name: 'Piyush', response_length: 'short' }], ai_memories: [{ value: 'birthday 5 June', created_at: '2026-10-01T00:00:00Z' }],
    messages: rows ?? [{ id: 'm3', sender_id: 'me', body: live, created_at: nowIso() }, { id: 'm2', sender_id: 'BOT', body: 'Yo!', created_at: '2026-10-08T10:00:00Z' }, { id: 'm1', sender_id: 'me', body: 'hi', created_at: '2026-10-08T09:59:59Z' }],
    inserted: [], posted: [], saved: [], rpcs: [] };
  const db = makeDb(state); db.__state = state;
  const deltas = [], stages = [], sources = [];
  const out = await lunaTurn({ db, userId: 'me', conversationId: 'c', isGroup: false, live, spoken: false, apiKey: 'k', base: 'https://x', model: 'gpt-6-luna', reasoningEffort: 'low', imageModel: 'gpt-image-2', emit: (s) => stages.push(s), emitSentence: () => {}, emitDelta: (d) => deltas.push(d), emitSources: (s) => sources.push(s), ...extra }, deps);
  return { out, state, deltas, stages, sources };
}

calls.length = 0;
let r = await run('kal movie chalein?');
assert.equal(r.out.status, 200);
assert.equal(calls.length, 1, 'plain turn = one request');
assert.equal(r.state.posted[0], 'Haan bhai, bilkul! Bata kya scene hai.');
assert.ok(r.deltas.length >= 1 && r.deltas.join('') === r.state.posted[0], 'deltas add up to the reply');
// Saved memories ride in the prompt: left to recall_memory, the model skipped the lookup on plain questions.
assert.ok(JSON.stringify(calls[0].input).includes('birthday 5 June'), 'memories are in the prompt');
assert.equal(calls[0].input.filter((m) => m.role === 'user' && m.content === 'kal movie chalein?').length, 1, 'live message not duplicated');
assert.equal(calls[0].input[0].role, 'system');
assert.deepEqual(calls[0].reasoning, { effort: 'low' });
assert.equal(calls[0].stream, true);
assert.equal(calls[0].store, false);
assert.equal(calls[0].prompt_cache_key, 'pingo-ai-me');
assert.deepEqual(calls[0].tools.map((t) => t.type), ['function', 'function', 'function', 'function', 'function', 'function', 'function', 'web_search', 'image_generation']);
assert.deepEqual(calls[0].tools.slice(3, 6).map((t) => t.name), ['add_goal', 'list_goals', 'complete_goal']);
assert.equal(calls[0].tools[0].name, 'save_memory', 'function tools in the Responses (flat) shape');
assert.equal(calls[0].tools[6].name, 'react_to_message', 'reactions are offered by default');
assert.equal(calls[0].tools[8].model, 'gpt-image-2');
assert.deepEqual(r.state.rpcs[0].args.reply_meta, { mood: 'happy' }, 'no tag: happy, stored with the reply');
assert.equal(r.out.body.mood, 'happy');
console.log('plain turn ok, stages', r.stages.join('>'));

// ---- PINGO Master: tools only propose, the card id rides with the reply, a false claim is replaced
calls.length = 0;
const actions = [];
r = await run('bhej rohit happy birthday', { master: true, emitAction: (a) => actions.push(a) });
assert.deepEqual(calls[0].tools.slice(6, 9).map((t) => t.name), ['find_chat', 'schedule_message', 'set_setting'], 'Master tools are offered when Master is on');
assert.ok(JSON.stringify(calls[0].input).includes('PINGO MASTER is on'), 'the Master rules are in the prompt');
assert.equal(calls.length, 3, 'find_chat, schedule_message, then the answer');
const proposal = r.state.rpcs.find((x) => x.fn === 'master_propose');
assert.equal(proposal.args.p_kind, 'send_message');
assert.equal(proposal.args.p_run_at, null, 'an empty send_at means as soon as approved');
assert.equal(proposal.args.p_params.text, 'Happy birthday!');
assert.deepEqual(actions, [{ id: 'aaaaaaaa-1111-4111-8111-111111111111', kind: 'send_message' }]);
assert.deepEqual(r.state.rpcs.find((x) => x.fn === 'post_ai_reply').args.reply_meta.actions, ['aaaaaaaa-1111-4111-8111-111111111111'], 'the Approve card is stored with the reply');

calls.length = 0;
r = await run('bhej ghost something', { master: true });
assert.ok(!/approve/i.test(r.state.posted[0]), 'a reply that claims an approval with no proposal is replaced');
assert.ok(!('actions' in r.state.rpcs.find((x) => x.fn === 'post_ai_reply').args.reply_meta));

calls.length = 0;
r = await run('bhej rohit happy birthday');
assert.ok(!calls[0].tools.some((t) => t.name === 'schedule_message'), 'no Master tools when Master is off');
console.log('master turn ok');

calls.length = 0;
r = await run('mera birthday kab hai?');
assert.equal(calls.length, 2, 'memory question = tool round + answer');
const round2 = calls[1].input;
assert.ok(round2.some((m) => m.type === 'reasoning' && m.encrypted_content === 'sealed'), 'sealed reasoning handed on');
assert.ok(round2.some((m) => m.type === 'function_call' && m.call_id === 'c1'), 'the call handed back');
assert.ok(round2.some((m) => m.type === 'function_call_output' && m.call_id === 'c1' && m.output.includes('birthday 5 June')), 'recalled memory given to model');
assert.equal(r.state.posted[0], 'Tera birthday 5 June hai. Party kab hai?');
console.log('recall turn ok, toolRounds', r.out.body.toolRounds);

calls.length = 0;
r = await run('yaad rakh mera fav colour blue hai');
assert.deepEqual(r.state.saved, ['mera fav colour blue hai']);
assert.equal(calls.length, 1);
assert.ok(JSON.stringify(calls[0].input).includes('You just saved this'), 'model told it was saved');
console.log('save fast-path ok');

calls.length = 0;
r = await run('aaj ka match score kya hai?');
assert.ok(r.stages.includes('searching'), 'searching stage');
assert.equal(r.state.posted[0], 'India won by 6 wickets.', 'inline citation taken out of the text');
assert.deepEqual(r.state.rpcs[0].args.reply_meta.sources, [{ title: 'IND v AUS', url: 'https://www.espn.com/m/1' }], 'sources stored with the reply');
assert.deepEqual(r.out.body.sources, [{ title: 'IND v AUS', url: 'https://www.espn.com/m/1' }]);
assert.equal(r.sources.length, 1, 'sources streamed');
console.log('web search ok');

calls.length = 0;
deps.__images.length = 0;
const images = [];
r = await run('ek cat ki photo banao', { emitImage: (i) => images.push(i) });
assert.ok(r.stages.includes('drawing') && r.stages.includes('uploading'), 'drawing, then uploading');
assert.equal(deps.__images.length, 1);
assert.equal(new TextDecoder().decode(deps.__images[0].image.bytes), 'WEBPBYTES');
assert.equal(deps.__images[0].image.contentType, 'image/webp');
assert.equal(deps.__images[0].caption, 'Ye lo!');
assert.equal(deps.__images[0].meta.image.revisedPrompt, 'A cat');
assert.deepEqual(images, [{ messageId: 'img-1', path: 'BOT/x.webp' }]);
assert.equal(r.state.posted.length, 0, 'no separate text message');
assert.equal(r.out.body.messageId, 'img-1');
console.log('image generation ok');

calls.length = 0;
r = await run('', {}, [
  { id: 'p1', sender_id: 'me', body: 'ye kya hai?', kind: 'photo', photo_path: 'me/a.jpg', created_at: nowIso() },
  { id: 'm2', sender_id: 'BOT', body: 'Yo!', created_at: '2026-10-08T10:00:00Z' },
]);
const lastUser = calls[0].input.filter((m) => m.role === 'user').pop();
assert.ok(Array.isArray(lastUser.content), 'photo turn sends parts');
assert.deepEqual(lastUser.content[1], { type: 'input_image', image_url: 'https://store/photos/me/a.jpg?token=t', detail: 'auto' });
assert.ok(lastUser.content[0].text.includes('ye kya hai?'));
assert.ok(r.stages.includes('looking'), 'looking stage');
console.log('vision ok');

// A photo on R2: the assistant is handed a short link from the media Worker, asked with the purge key.
{
  const R2_PHOTO = `r2:photo/${'1'.repeat(8)}-1111-4111-8111-111111111111/${'a'.repeat(32)}.jpg`;
  const real = globalThis.fetch;
  const asked = [];
  globalThis.Deno = { env: { get: (k) => ({ MEDIA_PURGE_KEY: 'purge-secret' })[k] } };
  globalThis.fetch = async (u, init) => {
    if (String(u).endsWith('/internal/sign')) {
      asked.push({ key: init.headers['x-purge-key'], body: JSON.parse(init.body) });
      return Response.json({ urls: { [R2_PHOTO]: 'https://media.test/s/photo/x?e=1&sig=s' } });
    }
    return real(u, init);
  };
  calls.length = 0;
  r = await run('', {}, [
    { id: 'p2', sender_id: 'me', body: 'ye kya hai?', kind: 'photo', photo_path: R2_PHOTO, created_at: nowIso() },
    { id: 'm3', sender_id: 'BOT', body: 'Yo!', created_at: '2026-10-08T10:00:00Z' },
  ]);
  globalThis.fetch = real;
  delete globalThis.Deno;
  const content = calls[0].input.filter((m) => m.role === 'user').pop().content;
  assert.deepEqual(content[1], { type: 'input_image', image_url: 'https://media.test/s/photo/x?e=1&sig=s', detail: 'auto' });
  assert.deepEqual(asked, [{ key: 'purge-secret', body: { paths: [R2_PHOTO], seconds: 600 } }]);
  console.log('vision on R2 ok');
}

calls.length = 0;
r = await run('kya haal?', { spoken: true });
assert.ok(!calls[0].tools.some((t) => t.type === 'image_generation'), 'no drawing on a call');
console.log('spoken ok');

{
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const b = JSON.parse(init.body); seen.push(b);
    if (b.prompt_cache_key) return new Response('{"error":{"message":"Unsupported parameter: prompt_cache_key","param":"prompt_cache_key"}}', { status: 400 });
    if (b.tools?.some((t) => t.type === 'web_search')) return new Response(`{"error":{"message":"Tool 'web_search' is not supported with this model.","param":"tools[0]"}}`, { status: 400 });
    return sse(textEvents('ok'));
  };
  const out = await streamResponse({ apiKey: 'k', base: 'https://x', model: 'm', input: [{ role: 'user', content: 'hi' }], tools: [{ type: 'web_search' }], reasoningEffort: 'none', maxTokens: 50, cacheKey: 'c' });
  assert.equal(out.stream.text, 'ok');
  assert.equal(seen.length, 3);
  assert.equal(seen[1].prompt_cache_key, undefined);
  assert.equal(seen[2].tools, undefined);
  assert.deepEqual(out.dropped, ['optional', 'web_search']);
  assert.equal(out.sealedReasoning, false, 'include was given up');
  console.log('optional-parameter and tool fallback ok');
  globalThis.fetch = real;
}
calls.length = 0;
r = await run('mood test');
assert.equal(r.state.posted[0], 'Wah, kya baat hai!');
assert.equal(r.out.body.mood, 'excited');
assert.equal(r.state.rpcs[0].args.reply_meta.mood, 'excited');
assert.ok(!r.deltas.join('').includes('[['), 'tag never streamed');
console.log('mood ok');

{
  const sentences = [];
  calls.length = 0;
  r = await run('mood test', { spoken: true, emitSentence: (x) => sentences.push(x) });
  assert.ok(sentences.length && sentences.every((x) => !x.includes('[[') && !x.includes('mood')), 'tag never spoken');
}

calls.length = 0;
r = await run('aaj ka match score kya hai?', { command: 'search' });
assert.deepEqual(calls[0].tool_choice, { type: 'allowed_tools', mode: 'required', tools: [{ type: 'web_search' }] }, '/search forces web search');
assert.ok(JSON.stringify(calls[0].input.at(-1)).includes('/search'), 'command note after the history, not in the cached opening');
assert.equal(calls[0].input[0].content.includes('/search'), false);

calls.length = 0;
r = await run('ek cat ki photo banao', { command: 'image' });
assert.deepEqual(calls[0].tool_choice.tools, [{ type: 'image_generation' }], '/image forces drawing');

calls.length = 0;
r = await run('kal movie chalein?', { command: 'translate' });
assert.equal(calls[0].tool_choice, 'auto');
assert.ok(JSON.stringify(calls[0].input.at(-1)).includes('/translate'));

calls.length = 0;
r = await run('mera fav colour blue hai', { command: 'remember' });
assert.equal(calls.length, 0, '/remember spends no model call');
assert.deepEqual(r.state.saved, ['mera fav colour blue hai']);
assert.equal(r.out.body.mood, 'happy');
assert.equal(r.out.body.memorySaved, true);
console.log('commands ok');

// ---- side chats: named once, from the hidden tag, which never reaches the screen
const named = [];
deps.nameChat = async (title) => { named.push(title); return true; };
calls.length = 0;
r = await run('how do I get into tennis?', {}, undefined, { conversations: [{ kind: 'ai', ai_side: true, title: 'New chat' }] });
assert.ok(JSON.stringify(calls[0].input.at(-1)).includes('[[title:'), 'first turn asks for a title, after the history');
assert.equal(calls[0].input[0].content.includes('[[title:'), false, 'cached opening unchanged');
assert.equal(r.state.posted[0], 'Start with a good racket and a coach.', 'title tag stripped from the reply');
assert.ok(!r.deltas.join('').includes('title'), 'title tag never streamed');
assert.deepEqual(named, ['Learning tennis basics']);
assert.equal(r.out.body.chatTitle, 'Learning tennis basics');

named.length = 0;
calls.length = 0;
r = await run('how do I get into tennis?', {}, undefined, { conversations: [{ kind: 'ai', ai_side: true, title: 'Tennis' }] });
assert.equal(JSON.stringify(calls[0].input.at(-1)).includes('[[title:'), false, 'a named chat is not asked again');
assert.deepEqual(named, []);

r = await run('kal movie chalein?', {}, undefined, { conversations: [{ kind: 'ai', ai_side: false, title: 'PINGO' }] });
assert.deepEqual(named, [], 'the main thread is never renamed');

r = await run('kal movie chalein?', {}, undefined, { conversations: [{ kind: 'ai', ai_side: true, title: 'New chat' }] });
assert.deepEqual(named, ['Kal movie chalein'], 'no tag: the first words');
delete deps.nameChat;
console.log('side chat titles ok');

// ---- goals
calls.length = 0;
r = await run('add a goal to learn tennis');
assert.equal(calls.length, 2, 'one tool round');
assert.deepEqual(r.state.inserted.find((x) => x.table === 'ai_goals')?.row, { user_id: 'me', title: 'Learn tennis' });
assert.equal(r.state.posted.at(-1), 'Added it to your goals.');
calls.length = 0;
r = await run('kal movie chalein?', { isGroup: true });
assert.equal(calls[0].tools.some((t) => t.name === 'add_goal'), false, 'no goals in a group');
console.log('goals ok');
// ---- the profile page's settings reach the request
{
  const { profileVoiceBlock } = await import('../../../supabase/functions/ai-chat/profile-prompt.ts');
  deps.profileVoiceBlock = profileVoiceBlock;
  calls.length = 0;
  r = await run('kal movie chalein?', {}, undefined, { ai_profiles: [{ memory_enabled: true, personality: 'concise', custom_instructions: 'Always reply in Hinglish', response_length: 'short' }] });
  const sent = JSON.stringify(calls[0]);
  assert.ok(sent.includes('Concise above all'), 'the chosen personality is in the request');
  assert.ok(sent.includes('Always reply in Hinglish'), 'their custom instructions are in the request');
  calls.length = 0;
  r = await run('kal movie chalein?', {}, undefined, { ai_profiles: [{ memory_enabled: true, personality: 'friendly', response_length: 'short' }] });
  assert.ok(!JSON.stringify(calls[0]).includes('THEIR INSTRUCTIONS'), 'no instructions block when they wrote none');
  delete deps.profileVoiceBlock;

  // Memory off: nothing new is saved, by the command, by "yaad rakh", or by the tool.
  r = await run('yaad rakh my bike is red', {}, undefined, { ai_profiles: [{ memory_enabled: false }] });
  assert.deepEqual(r.state.saved, [], '"yaad rakh" saves nothing with memory off');
  r = await run('my bike is red', { command: 'remember' }, undefined, { ai_profiles: [{ memory_enabled: false }] });
  assert.deepEqual(r.state.saved, [], '/remember saves nothing with memory off');
  assert.match(r.state.posted.at(-1), /switched off/);
  calls.length = 0;
  r = await run('kal movie chalein?', {}, undefined, { ai_profiles: [{ memory_enabled: false }] });
  assert.ok(JSON.stringify(calls[0]).includes('Memory is switched off'), 'the model is told memory is off');
  console.log('profile settings ok');
}
console.log('ALL OK');

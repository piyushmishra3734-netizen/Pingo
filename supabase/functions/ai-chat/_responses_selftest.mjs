/**
 * Offline self-test for the Responses API stream reader (no OpenAI key).
 * Runs the real `responses-events.ts` against recorded-shape event streams:
 *
 *   node --experimental-strip-types supabase/functions/ai-chat/_responses_selftest.mjs
 *
 * Covers: text deltas split across chunks, a web search with url_citation
 * annotations, an image_generation_call with a partial and a final picture, a
 * function call whose arguments arrive in pieces, error events, and the 400
 * handling that drops what a model refuses, and the hidden mood tag that
 * must never reach the screen or the voice.
 */
import assert from 'node:assert/strict';
import { MoodFilter, relaxRequest, ResponsesStream, SseSplitter, stripCitations, takeMood } from './responses-events.ts';

let fail = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log('PASS', name);
  } catch (err) {
    fail++;
    console.log('FAIL', name, '\n ', err.message);
  }
};

/** Events as OpenAI writes them on the wire: `event:` then `data:`, a blank line after each. */
const wire = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** Feed a wire string in awkward pieces, the way a network delivers it. */
function run(events, hooks = {}, chunk = 7) {
  const text = wire(events);
  const s = new ResponsesStream(hooks);
  const sse = new SseSplitter();
  for (let i = 0; i < text.length; i += chunk) for (const e of sse.push(text.slice(i, i + chunk))) s.feed(e);
  for (const e of sse.end()) s.feed(e);
  return s;
}

const usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 1024 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 8 } };

test('text deltas, split mid-event', () => {
  const pieces = [];
  const s = run(
    [
      { type: 'response.created', sequence_number: 0, response: { id: 'resp_1', status: 'in_progress' } },
      { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', sequence_number: 2, item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Haan bhai, ' },
      { type: 'response.output_text.delta', sequence_number: 3, item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'bilkul! ' },
      { type: 'response.output_text.delta', sequence_number: 4, item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'नमस्ते 🙂' },
      { type: 'response.output_text.done', sequence_number: 5, item_id: 'msg_1', output_index: 0, content_index: 0, text: 'Haan bhai, bilkul! नमस्ते 🙂' },
      {
        type: 'response.output_item.done',
        sequence_number: 6,
        output_index: 0,
        item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Haan bhai, bilkul! नमस्ते 🙂', annotations: [] }] },
      },
      { type: 'response.completed', sequence_number: 7, response: { id: 'resp_1', status: 'completed', usage, output: [] } },
    ],
    { onText: (d) => pieces.push(d) },
    5,
  );
  assert.equal(s.text, 'Haan bhai, bilkul! नमस्ते 🙂');
  assert.equal(pieces.join(''), s.text, 'deltas add up, and the done item does not repeat them');
  assert.equal(s.status, 'completed');
  assert.equal(s.usage.input_tokens_details.cached_tokens, 1024);
  assert.equal(s.responseId, 'resp_1');
  assert.equal(s.calls.length, 0);
});

test('web search: stage, url_citation sources, inline citation stripped', () => {
  const activity = [];
  const seen = [];
  const answer = 'India won by 6 wickets ([espncricinfo.com](https://www.espncricinfo.com/match/123?utm_source=openai)). Next match is Sunday ([bbc.com](https://www.bbc.com/sport/x?utm_source=openai)).';
  const s = run(
    [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress' } },
      { type: 'response.web_search_call.in_progress', output_index: 0, item_id: 'ws_1' },
      { type: 'response.web_search_call.searching', output_index: 0, item_id: 'ws_1' },
      { type: 'response.web_search_call.completed', output_index: 0, item_id: 'ws_1' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'india match result' } } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_2', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', output_index: 1, item_id: 'msg_2', content_index: 0, delta: answer },
      {
        type: 'response.output_text.annotation.added',
        output_index: 1,
        item_id: 'msg_2',
        content_index: 0,
        annotation_index: 0,
        annotation: { type: 'url_citation', start_index: 23, end_index: 100, title: 'India vs Australia, 3rd ODI', url: 'https://www.espncricinfo.com/match/123?utm_source=openai' },
      },
      {
        type: 'response.output_item.done',
        output_index: 1,
        item: {
          type: 'message',
          id: 'msg_2',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: answer,
              annotations: [
                { type: 'url_citation', start_index: 23, end_index: 100, title: 'India vs Australia, 3rd ODI', url: 'https://www.espncricinfo.com/match/123?utm_source=openai' },
                { type: 'url_citation', start_index: 120, end_index: 170, title: '', url: 'https://www.bbc.com/sport/x?utm_source=openai' },
                { type: 'url_citation', start_index: 0, end_index: 1, title: 'bad', url: 'javascript:alert(1)' },
              ],
            },
          ],
        },
      },
      { type: 'response.completed', response: { status: 'completed', usage } },
    ],
    { onActivity: (a) => activity.push(a), onSources: (all) => seen.push(all.length) },
  );
  assert.ok(activity.includes('searching'), 'searching reported');
  assert.equal(activity[activity.length - 1], 'writing');
  assert.equal(s.searches, 1);
  assert.deepEqual(s.sources, [
    { title: 'India vs Australia, 3rd ODI', url: 'https://www.espncricinfo.com/match/123' },
    { title: 'bbc.com', url: 'https://www.bbc.com/sport/x' },
  ]);
  assert.deepEqual(seen, [1, 2], 'each new source announced once, duplicates and non-http dropped');
  assert.equal(stripCitations(s.text, s.sources), 'India won by 6 wickets. Next match is Sunday.');
  assert.equal(stripCitations('See [docs](https://x.dev/a) here.', s.sources), 'See [docs](https://x.dev/a) here.', 'uncited links stay');
  assert.ok(s.items.some((i) => i.type === 'web_search_call'), 'search item kept for the next round');
});

test('image generation: partial and final picture', () => {
  const activity = [];
  const partials = [];
  const s = run([
    { type: 'response.output_item.added', output_index: 0, item: { type: 'image_generation_call', id: 'ig_1', status: 'in_progress' } },
    { type: 'response.image_generation_call.in_progress', output_index: 0, item_id: 'ig_1' },
    { type: 'response.image_generation_call.generating', output_index: 0, item_id: 'ig_1' },
    { type: 'response.image_generation_call.partial_image', output_index: 0, item_id: 'ig_1', partial_image_index: 0, partial_image_b64: 'UEFSVElBTA==' },
    { type: 'response.image_generation_call.completed', output_index: 0, item_id: 'ig_1' },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: 'RklOQUw=', output_format: 'webp', revised_prompt: 'A cat on a red bicycle in the rain' },
    },
    { type: 'response.output_text.delta', output_index: 1, item_id: 'msg_3', content_index: 0, delta: 'Ye lo!' },
    { type: 'response.completed', response: { status: 'completed', usage } },
  ], { onActivity: (a) => activity.push(a), onPartialImage: (b64, i) => partials.push([b64, i]) });
  assert.ok(activity.includes('drawing'));
  assert.deepEqual(partials, [['UEFSVElBTA==', 0]]);
  assert.equal(s.images.length, 1);
  assert.deepEqual(s.images[0], { id: 'ig_1', b64: 'RklOQUw=', format: 'webp', revisedPrompt: 'A cat on a red bicycle in the rain' });
  assert.equal(s.imageFailed, false);
  assert.equal(s.text, 'Ye lo!');
});

test('image generation that ends without a picture is marked failed', () => {
  const s = run([
    { type: 'response.image_generation_call.in_progress', output_index: 0, item_id: 'ig_2' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'image_generation_call', id: 'ig_2', status: 'failed', result: null } },
    { type: 'response.completed', response: { status: 'completed' } },
  ]);
  assert.equal(s.images.length, 0);
  assert.equal(s.imageFailed, true);
});

test('function call: arguments in pieces, reasoning kept for the next round', () => {
  const s = run([
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [] } },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'gAAAA...' } },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_abc', name: 'recall_memory', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_1', delta: '{"query":"birth' },
    { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_1', delta: 'day"}' },
    { type: 'response.function_call_arguments.done', output_index: 1, item_id: 'fc_1', arguments: '{"query":"birthday"}' },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_abc', name: 'recall_memory', arguments: '{"query":"birthday"}', status: 'completed' } },
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        usage,
        // The same items again in the final output: not counted twice.
        output: [
          { type: 'reasoning', id: 'rs_1', summary: [] },
          { type: 'function_call', id: 'fc_1', call_id: 'call_abc', name: 'recall_memory', arguments: '{"query":"birthday"}' },
        ],
      },
    },
  ]);
  assert.deepEqual(s.calls, [{ id: 'fc_1', call_id: 'call_abc', name: 'recall_memory', arguments: '{"query":"birthday"}' }]);
  assert.deepEqual(s.items.map((i) => i.type), ['reasoning', 'function_call']);
  assert.equal(s.text, '');
});

test('arguments only from deltas when the done item has none', () => {
  const s = run([
    { type: 'response.function_call_arguments.delta', item_id: 'fc_9', delta: '{"text":"fav colour ' },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_9', delta: 'blue"}' },
    { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_9', call_id: 'call_9', name: 'save_memory' } },
  ]);
  assert.equal(s.calls[0].arguments, '{"text":"fav colour blue"}');
});

test('error, failed and incomplete', () => {
  let s = run([{ type: 'error', code: 'rate_limit_exceeded', message: 'Slow down', param: null }]);
  assert.deepEqual(s.error, { code: 'rate_limit_exceeded', message: 'Slow down' });
  s = run([{ type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'boom' } } }]);
  assert.equal(s.status, 'failed');
  assert.equal(s.error.message, 'boom');
  s = run([
    { type: 'response.output_text.delta', item_id: 'm', delta: 'Partial' },
    { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
  ]);
  assert.equal(s.incompleteReason, 'max_output_tokens');
  assert.equal(s.text, 'Partial');
});

test('SSE: CRLF, [DONE], junk and a last event with no blank line', () => {
  const sse = new SseSplitter();
  const got = [
    ...sse.push('event: x\r\ndata: {"type":"response.output_text.delta","delta":"a"}\r\n\r\n'),
    ...sse.push(': keep-alive\n\ndata: not json\n\ndata: [DONE]\n\n'),
    ...sse.push('data: {"type":"response.output_text.delta","delta":"b"}'),
  ];
  assert.equal(got.length, 1);
  assert.equal(sse.end().length, 1);
});

test('400 handling: what each refusal gives up', () => {
  const base = () => ({
    model: 'gpt-6-luna',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'what is this?' }, { type: 'input_image', image_url: 'https://x/y.jpg', detail: 'auto' }] }],
    tools: [{ type: 'function', name: 'recall_memory' }, { type: 'web_search' }, { type: 'image_generation', model: 'gpt-image-2' }],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'minimal' },
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: 'k',
  });
  const err = (message, param = null) => JSON.stringify({ error: { message, type: 'invalid_request_error', param, code: null } });

  let b = base();
  assert.equal(relaxRequest(b, err("The following tools cannot be used with reasoning.effort 'minimal': web_search.", 'tools')), 'reasoning');
  assert.equal(b.reasoning, undefined);
  assert.equal(b.tools.length, 3, 'the effort goes before any tool');

  b = base();
  delete b.reasoning;
  assert.equal(relaxRequest(b, err("Tool 'web_search' is not supported with gpt-6-luna.", 'tools[1].type')), 'web_search');
  assert.deepEqual(b.tools.map((t) => t.type), ['function', 'image_generation']);

  b = base();
  delete b.reasoning;
  assert.equal(relaxRequest(b, err('Your organization must be verified to use the model `gpt-image-2`.')), 'image_generation.model');
  assert.equal(b.tools[2].model, undefined);
  assert.equal(relaxRequest(b, err('Your organization must be verified to use the model `gpt-image-1`.')), 'image_generation');
  assert.deepEqual(b.tools.map((t) => t.type), ['function', 'web_search']);

  b = base();
  delete b.reasoning;
  assert.equal(relaxRequest(b, err('Error while downloading https://x/y.jpg.', 'url')), 'media');
  assert.equal(b.input[0].content[1].type, 'input_text');

  b = base();
  delete b.reasoning;
  assert.equal(relaxRequest(b, err("Unsupported parameter: 'prompt_cache_key'.", 'prompt_cache_key')), 'optional');
  assert.equal(b.prompt_cache_key, undefined);
  assert.equal(b.include, undefined);
  assert.equal(b.tool_choice, undefined);

  b = base();
  b.reasoning = { effort: 'low' };
  assert.equal(relaxRequest(b, err("Function tools with reasoning_effort are not supported for gpt-6-luna; use 'none'.")), 'reasoning.effort=none');
  assert.deepEqual(b.reasoning, { effort: 'none' });

  b = base();
  assert.equal(relaxRequest(b, err('The model `gpt-6-lunaa` does not exist or you do not have access to it.', 'model')), null, 'a wrong model name stands');

  b = { model: 'm', input: [], tools: [{ type: 'image_generation' }], tool_choice: 'auto', parallel_tool_calls: false };
  assert.equal(relaxRequest(b, err("Tool 'image_generation' is not supported.")), 'image_generation');
  assert.equal(b.tools, undefined, 'no tools left: no tool_choice either');
  assert.equal(b.tool_choice, undefined);
});

test('mood tag: held back across pieces, never shown', () => {
  const pieces = ['Sure! Here', ' is a [link](https://a.b) and [1].', ' Bye', ' 👋\n[', '[mo', 'od:exci', 'ted]', ']'];
  const f = new MoodFilter();
  let shown = '';
  for (const p of pieces) {
    const out = f.push(p);
    assert.ok(!out.includes('[['), `no tag fragment in "${out}"`);
    shown += out;
  }
  shown += f.end();
  assert.equal(shown, 'Sure! Here is a [link](https://a.b) and [1]. Bye 👋\n');
  assert.equal(f.mood, 'excited');
  assert.deepEqual(takeMood(pieces.join('')), { text: 'Sure! Here is a [link](https://a.b) and [1]. Bye 👋', mood: 'excited' });
});

test('mood tag: unknown mood, missing tag, cut-off tag', () => {
  assert.equal(takeMood('Ok [[mood:ecstatic]]').mood, 'happy', 'unknown word becomes happy');
  assert.deepEqual(takeMood('No tag here.'), { text: 'No tag here.', mood: undefined });
  const f = new MoodFilter();
  assert.equal(f.push('Done. [[mood:sa'), 'Done. ');
  assert.equal(f.end(), '', 'a tag cut off by the token limit is dropped, not shown');
  const g = new MoodFilter();
  assert.equal(g.push('array[') + g.end(), 'array[', 'a lone bracket at the end is text');
});

test('a forced tool that is refused is no longer forced', () => {
  const b = {
    model: 'm',
    input: [],
    tools: [{ type: 'function', name: 'x' }, { type: 'web_search' }],
    tool_choice: { type: 'allowed_tools', mode: 'required', tools: [{ type: 'web_search' }] },
  };
  assert.equal(relaxRequest(b, JSON.stringify({ error: { message: "Tool 'web_search' is not supported." } })), 'web_search');
  assert.equal(b.tool_choice, 'auto');
});

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

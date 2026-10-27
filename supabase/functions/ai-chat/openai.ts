/**
 * OpenAI Responses API (POST /v1/responses), streamed, with tools.
 *
 * One request, read as it is written: each piece of text is handed on the
 * moment it arrives (the thread shows it as it is written, the voice starts on
 * the first sentence), web searches and drawings are reported as they start,
 * and function calls are collected whole and returned for the caller to run.
 * No SDK: a fetch and an event reader (`responses-events.ts`) are the whole of
 * it, and nothing extra loads on a cold start.
 *
 * Responses rather than Chat Completions because the native tools live there:
 * `web_search` answers with live sources, `image_generation` draws and edits,
 * and images and PDFs go in as input next to the text.
 */

import { relaxRequest, ResponsesStream, SseSplitter, type StreamHooks } from './responses-events.ts';

export type { DrawnImage, FunctionCall, Source } from './responses-events.ts';

export type InputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'auto' | 'low' | 'high' }
  | { type: 'input_file'; filename: string; file_data: string };

/** A message, a function's answer, or an output item of an earlier round sent back as it came. */
export type InputItem =
  | { role: 'system' | 'developer' | 'user' | 'assistant'; content: string | InputPart[] }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: string; [key: string]: unknown };

export interface FunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

/** OpenAI's own tools: `web_search`, `image_generation`, configured by the caller. */
export interface BuiltinTool {
  type: 'web_search' | 'image_generation';
  [key: string]: unknown;
}

export type Tool = FunctionTool | BuiltinTool;

export interface StreamOptions extends StreamHooks {
  apiKey: string;
  base: string;
  model: string;
  input: InputItem[];
  tools?: Tool[];
  /** "none" | "minimal" | "low" | "medium" | "high", as the model allows. Empty: not sent. */
  reasoningEffort?: string;
  maxTokens: number;
  /** Groups one person's requests, so the cached prefix is found again. */
  cacheKey?: string;
  /** A built-in tool this request must call (a /search or /image command). Default: the model decides. */
  force?: BuiltinTool['type'];
  signal?: AbortSignal;
}

export interface StreamResult {
  stream: ResponsesStream;
  /** What a refusal made this request give up: a tool type, 'media', 'reasoning', ... */
  dropped: string[];
  /**
   * Reasoning items came back sealed and can be sent again next round. False
   * when `include` was refused, and then they must not be: with `store: false`
   * a bare reasoning id points at nothing.
   */
  sealedReasoning: boolean;
  /** The tools as finally sent, so the next round does not ask for a refused one again. */
  tools: Tool[];
}

/** Each refusal gets one retry with less; past this many the error stands. */
const MAX_RELAX = 5;

/**
 * How long a turn may sit with nothing coming back before it is given up on.
 * Most answers start within two or three seconds; the odd request stalls for a
 * minute, and a second try almost always starts at once. Only the wait before
 * the first piece of output is timed, so a long search or drawing is not cut.
 */
const FIRST_OUTPUT_MS = 20_000;
export const STALLED = 'OpenAI stalled before replying';

export async function streamResponse(o: StreamOptions): Promise<StreamResult> {
  const guard = new AbortController();
  let stalled = false;
  const relay = () => guard.abort();
  if (o.signal?.aborted) guard.abort();
  else o.signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => {
    stalled = true;
    guard.abort();
  }, FIRST_OUTPUT_MS);
  try {
    return await streamResponseOnce({ ...o, signal: guard.signal }, () => clearTimeout(timer));
  } catch (err) {
    if (stalled && !o.signal?.aborted) throw new Error(STALLED);
    throw err;
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', relay);
  }
}

async function streamResponseOnce(o: StreamOptions, started: () => void): Promise<StreamResult> {
  const body: Record<string, unknown> = {
    model: o.model,
    input: o.input,
    stream: true,
    /*
     * Not kept on OpenAI's side: every turn sends its own window, so a stored
     * copy would be a second history of somebody's chat for nothing. Reasoning
     * comes back sealed instead, so a tool round can still hand it on.
     */
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: o.maxTokens,
    // Copied: a refusal edits the tools, and the caller's list is shared by every turn.
    ...(o.tools?.length ? { tools: o.tools.map((t) => ({ ...t })), tool_choice: toolChoice(o), parallel_tool_calls: false } : {}),
    ...(o.reasoningEffort ? { reasoning: { effort: o.reasoningEffort } } : {}),
    ...(o.cacheKey ? { prompt_cache_key: o.cacheKey } : {}),
  };

  const dropped: string[] = [];
  let res = await post(o, body);
  while (res.status === 400) {
    const detail = await res.text();
    const gave = dropped.length < MAX_RELAX ? relaxRequest(body, detail) : null;
    if (!gave) {
      // A bad OPENAI_MODEL secret: name what was sent and what this key can use, so the fix is one secret.
      const hint = /model/i.test(detail) && !/gpt-image/i.test(detail) ? ` | sent ${JSON.stringify(o.model)}; this key can use: ${await modelIds(o)}` : '';
      throw new Error(`OpenAI 400: ${detail.slice(0, 300)}${hint}`);
    }
    console.warn(`[openai] retrying without ${gave}: ${detail.slice(0, 200)}`);
    dropped.push(gave);
    res = await post(o, body);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
  }

  const stream = new ResponsesStream(o);
  const sse = new SseSplitter();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const event of sse.push(value)) {
      const type = (event as { type?: string } | null)?.type ?? '';
      if (type.startsWith('response.output_') || type.startsWith('response.function_call')) started();
      stream.feed(event);
    }
  }
  for (const event of sse.end()) stream.feed(event);

  return {
    stream,
    dropped,
    sealedReasoning: Array.isArray(body.include),
    tools: (body.tools as Tool[] | undefined) ?? [],
  };
}

/*
 * `allowed_tools` with mode `required`, not `{ type: 'web_search' }`: the plain
 * form lists only some built-in tools (web_search_preview, image_generation),
 * and this one names any tool. The tool list itself is unchanged, so the
 * cached prefix is too.
 */
function toolChoice(o: StreamOptions): unknown {
  if (!o.force || !o.tools?.some((t) => t.type === o.force)) return 'auto';
  return { type: 'allowed_tools', mode: 'required', tools: [{ type: o.force }] };
}

async function modelIds(o: StreamOptions): Promise<string> {
  try {
    const res = await fetch(`${o.base}/models`, { headers: { Authorization: `Bearer ${o.apiKey}` } });
    const ids = ((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
    const near = ids.filter((id) => /luna|gpt-6/i.test(id));
    return (near.length ? near : ids.filter((id) => id.startsWith('gpt-')).slice(0, 25)).join(', ') || `(none, ${res.status})`;
  } catch {
    return '(could not list)';
  }
}

function post(o: StreamOptions, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${o.base}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(o.signal ? { signal: o.signal } : {}),
  });
}

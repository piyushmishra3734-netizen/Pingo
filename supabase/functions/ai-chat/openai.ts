/**
 * OpenAI Chat Completions, streamed, with tools.
 *
 * One request, read as it is written: each piece of text is handed on the
 * moment it arrives (the thread shows it as it is written, the voice starts on
 * the first sentence), and tool calls are collected whole and returned for the
 * caller to run. No SDK: a fetch and a line reader are the whole of it, and
 * nothing extra loads on a cold start.
 */

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
  finish: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export interface StreamOptions {
  apiKey: string;
  base: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** "none" | "minimal" | "low" | "medium" | "high", as the model allows. Empty: not sent. */
  reasoningEffort?: string;
  maxTokens: number;
  /** Groups one person's requests, so the cached prefix is found again. */
  cacheKey?: string;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

/**
 * Optional parameters a model may refuse. A 400 naming one of them is retried
 * once without them all: a newer or older model should still answer, just
 * without the extra.
 */
const OPTIONAL = ['reasoning_effort', 'prompt_cache_key', 'stream_options', 'parallel_tool_calls', 'tool_choice'];

export async function streamChat(o: StreamOptions): Promise<StreamResult> {
  const body: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: o.maxTokens,
    ...(o.tools?.length ? { tools: o.tools, tool_choice: 'auto', parallel_tool_calls: false } : {}),
    ...(o.reasoningEffort ? { reasoning_effort: o.reasoningEffort } : {}),
    ...(o.cacheKey ? { prompt_cache_key: o.cacheKey } : {}),
  };

  let res = await post(o, body);
  if (res.status === 400) {
    const detail = await res.text();
    if (OPTIONAL.some((p) => detail.includes(p))) {
      for (const p of OPTIONAL) delete body[p];
      res = await post(o, body);
    } else {
      throw new Error(`OpenAI 400: ${detail.slice(0, 300)}`);
    }
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
  }

  let text = '';
  let finish = '';
  let usage: StreamResult['usage'];
  const calls = new Map<number, ToolCall>();

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      let chunk: {
        choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
        usage?: StreamResult['usage'];
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const piece = choice.delta?.content;
      if (piece) {
        text += piece;
        o.onText?.(piece);
      }
      for (const t of choice.delta?.tool_calls ?? []) {
        const cur = calls.get(t.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
        if (t.id) cur.id = t.id;
        if (t.function?.name) cur.function.name += t.function.name;
        if (t.function?.arguments) cur.function.arguments += t.function.arguments;
        calls.set(t.index, cur);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }

  return { text, toolCalls: [...calls.values()].filter((c) => c.function.name), finish, ...(usage ? { usage } : {}) };
}

function post(o: StreamOptions, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${o.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(o.signal ? { signal: o.signal } : {}),
  });
}

/**
 * Request bodies that a provider will always accept.
 *
 * Text is cut with `.slice(0, n)` in many places (a long message, a transcript,
 * a clip). An emoji is two UTF-16 units, and a cut between them leaves half of
 * it: a lone surrogate. `JSON.stringify` writes that as `\ud83d`, which is legal
 * JSON, but OpenAI and the Spicy providers reject it outright - "failed to parse
 * JSON value" / "unexpected end of hex escape" - so the one message that holds
 * it breaks every turn of that chat for as long as it sits in the history. In a
 * busy group that is the whole conversation, with nothing to say why.
 *
 * Every string is made well-formed on its way out: a half emoji becomes U+FFFD.
 */

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, '�');
}

export function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'string' ? wellFormed(item) : item));
}

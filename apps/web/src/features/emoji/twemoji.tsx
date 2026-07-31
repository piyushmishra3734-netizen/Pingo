import { useMemo } from 'react';

/**
 * Twemoji rendering.
 *
 * ## The problem this solves
 *
 * Native emoji are drawn by the operating system, so 😂 is a different picture
 * on iOS, Android, Windows and Linux - and in a messaging product that means
 * two people looking at the same message see different things. Skin tones and
 * newer emoji fare worse: an unsupported codepoint renders as a blank box.
 *
 * Twemoji replaces them with images, so everyone sees the same emoji.
 *
 * ## Licence, and the attribution it requires
 *
 * `@twemoji/api` is published as **"MIT AND CC-BY-4.0"** - the code is MIT, the
 * *graphics* are CC-BY-4.0. CC-BY is permissive but not attribution-free:
 * shipping these images obliges PINGO to credit Twitter/the Twemoji project
 * somewhere visible. That belongs in Settings → Help → About before release.
 *
 * ## Parsing here rather than with the library's DOM helper
 *
 * `twemoji.parse()` takes an element and rewrites its `innerHTML`, which in
 * React means either `dangerouslySetInnerHTML` or fighting the reconciler. This
 * walks the string instead and returns React nodes, so message bodies stay
 * ordinary text that React owns, no HTML injection surface, no lost updates.
 */

/** jsDelivr mirror of the Twemoji SVG assets, pinned so a release cannot shift. */
const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg';

/**
 * Matches emoji, including sequences: ZWJ families, skin-tone modifiers, flags
 * and keycaps. Splitting on codepoints alone would tear 👩‍👩‍👧 into four pictures.
 */
const EMOJI_PATTERN =
  /(\p{RI}\p{RI}|\p{Emoji}(\p{EMod}|️⃣?|[\u{E0020}-\u{E007E}]+\u{E007F})?(‍(\p{RI}\p{RI}|\p{Emoji}(\p{EMod}|️⃣?|[\u{E0020}-\u{E007E}]+\u{E007F})?))*)/gu;

/** Codepoints to the filename Twemoji uses. */
function toCodepoints(emoji: string): string {
  const points: string[] = [];

  for (const character of emoji) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    // U+FE0F is a presentation selector; Twemoji's filenames omit it except on
    // keycaps, where the sequence would otherwise be ambiguous.
    if (code === 0xfe0f && emoji.length > 2) continue;
    points.push(code.toString(16));
  }

  return points.join('-');
}

export function twemojiUrl(emoji: string): string {
  return `${CDN}/${toCodepoints(emoji)}.svg`;
}

/**
 * Renders text with its emoji replaced by Twemoji images.
 *
 * Non-emoji text passes through untouched, so this is safe to wrap any message
 * body in.
 */
export function Twemoji({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const nodes: (string | { emoji: string })[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(EMOJI_PATTERN)) {
      const index = match.index ?? 0;
      if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
      nodes.push({ emoji: match[0] });
      lastIndex = index + match[0].length;
    }

    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
    return nodes;
  }, [text]);

  return (
    <span className={className}>
      {parts.map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : (
          <img
            key={index}
            src={twemojiUrl(part.emoji)}
            alt={part.emoji}
            draggable={false}
            /*
             * `1em` and the small negative baseline shift make the image sit on
             * the text baseline at whatever size the surrounding type is - the
             * detail that separates inline emoji from pasted-in pictures.
             */
            className="inline-block h-[1.15em] w-[1.15em] select-none align-[-0.18em]"
            loading="lazy"
            onError={(event) => {
              /*
               * A codepoint Twemoji has no asset for. Falling back to the
               * native character is strictly better than a broken-image icon,
               * and it is why this component never hides the original text.
               */
              const image = event.currentTarget;
              const fallback = document.createTextNode(part.emoji);
              image.replaceWith(fallback);
            }}
          />
        ),
      )}
    </span>
  );
}

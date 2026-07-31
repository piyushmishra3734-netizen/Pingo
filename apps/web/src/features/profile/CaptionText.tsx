import { linkify } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Link } from 'react-router-dom';

/**
 * A caption or a bio, with its mentions, hashtags and links made live.
 *
 * ## Why this is not `MessageText`
 *
 * A message carries links and nothing else - a chat has no hashtags and an
 * @name in a message is a name, not a route. A caption has all three, and two
 * of them navigate inside the app rather than out of it, so they cannot be
 * anchors. Sharing one component would mean a prop that switches half its
 * behaviour, which is two components wearing one name.
 *
 * ## Built as nodes, never as HTML
 *
 * Same rule as the chat: the text is user input, so it is turned into React
 * elements rather than into markup. `dangerouslySetInnerHTML` here would let
 * one person's caption run script on everybody else's profile.
 *
 * ## What counts as a mention
 *
 * `@` followed by the same characters a username can contain - 3 to 20 of
 * `[a-z0-9_]`. Deliberately not "any word after an @", so an email address that
 * survived linkify, or a caption reading "meet me @ 6", stays plain text.
 *
 * A mention is not checked against the database. Linking to a handle nobody has
 * lands on "this profile doesn't exist", which is a truthful answer and much
 * cheaper than a lookup per word.
 */

/** Mentions and hashtags, in one pass so neither can swallow the other. */
const TOKEN = /(@[a-z0-9_]{3,20}|#[\p{L}\p{N}_]{1,60})/giu;

export function CaptionText({
  text,
  className,
  /** White on a dark viewer; brand on a light profile. */
  tone = 'default',
}: {
  text: string;
  className?: string;
  tone?: 'default' | 'onDark';
}) {
  const accent = tone === 'onDark' ? 'text-white underline' : 'text-brand hover:underline';

  return (
    <span className={cn('break-words whitespace-pre-wrap', className)}>
      {text.split(TOKEN).map((part, index) => {
        // Odd indices are the captured tokens; even ones are the text between.
        if (index % 2 === 1) {
          if (part.startsWith('@')) {
            return (
              <Link
                key={index}
                to={`/profile/${part.slice(1).toLowerCase()}`}
                onClick={(event) => event.stopPropagation()}
                className={cn('focus-ring rounded-sm', accent)}
              >
                {part}
              </Link>
            );
          }

          /*
           * A hashtag is styled but does not navigate. PINGO has no search over
           * tags and no explore surface to land on, so a link would go nowhere  - 
           * and a hashtag that looks tappable and is not is worse than one that
           * simply reads as a hashtag.
           */
          return (
            <span key={index} className={tone === 'onDark' ? 'text-white/80' : 'text-brand'}>
              {part}
            </span>
          );
        }

        // Everything else still gets ordinary link detection.
        return linkify(part).map((segment, inner) =>
          segment.kind === 'text' ? (
            <span key={`${index}-${inner}`}>{segment.value}</span>
          ) : (
            <a
              key={`${index}-${inner}`}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className={cn('focus-ring rounded-sm', accent)}
            >
              {segment.value}
            </a>
          ),
        );
      })}
    </span>
  );
}

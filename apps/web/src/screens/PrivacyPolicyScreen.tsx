import { ChevronLeftIcon, IconButton, cn } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { applyPageSeo } from '../lib/seo.js';

/**
 * The privacy policy.
 *
 * ## Not the same thing as the Privacy settings screen
 *
 * `/settings/privacy` is a set of toggles - who can find you, who sees your
 * stories. This is the document about what PINGO collects and who else touches
 * it. Conflating the two is what made the download page's "Privacy" link point
 * at a page of switches, which is the sort of thing a visitor notices.
 *
 * ## Written from the schema, not from a template
 *
 * Every item in the list of what is collected corresponds to a table or a
 * storage bucket that actually exists. Nothing here describes data PINGO does
 * not hold, and - more importantly - nothing that *is* held has been left out
 * because it was awkward. The read-cursor history is in here. So is the fact
 * that Google sees an IP address for every visitor because the typeface is
 * served from their CDN, which almost no policy of this size mentions.
 */

const UPDATED = '28 July 2026';

interface Section {
  id: string;
  title: string;
  body: string[];
  /** Rendered as a list rather than prose, where a list is what it is. */
  list?: string[];
}

const SECTIONS: Section[] = [
  {
    id: 'summary',
    title: 'The short version',
    body: [
      'PINGO stores what it needs to deliver your messages and nothing that exists to profile you. There is no advertising, no analytics, no tracking SDK and no third party we sell anything to.',
      'The one thing we want you to notice rather than skim: your messages are encrypted in transit and at rest, but they are not end-to-end encrypted. PINGO could technically read them. We do not, and nothing in the product does - but that is a policy, not a mathematical guarantee, and you should know which of the two you are relying on.',
    ],
  },
  {
    id: 'collected',
    title: 'What PINGO holds',
    body: ['Everything below exists because a feature needs it. Nothing is kept "just in case".'],
    list: [
      'Account: your email address or phone number, and a password that is stored only as a hash. If you sign in with Google, we receive your email address and nothing else.',
      'Profile: username, display name, avatar and bio.',
      'Messages: text, photos, voice notes, documents and stickers, with the time they were sent.',
      'Delivery: how far each person has read in each conversation, and when their read position moved. This is what draws the second tick and the "Seen" line.',
      'Stories: the media, caption, chosen audience, and who has viewed or liked each one.',
      'Posts: up to three per profile, with their captions, likes, comments and saves.',
      'Connections: who follows whom, who you have blocked, and reports you have filed.',
      'Calls: who called whom, when, and for how long. The audio and video themselves are never recorded or stored.',
      'Per-chat preferences: pinned, muted, archived, and which lists a chat is filed under.',
    ],
  },
  {
    id: 'notheld',
    title: 'What PINGO does not hold',
    body: [],
    list: [
      'Your contacts. PINGO never reads your address book.',
      'Your location, unless you deliberately attach one to a message or a story.',
      'Any advertising or behavioural profile. There is no ad network in this product.',
      'Analytics. There is no tracking script, no session recorder and no product-analytics SDK anywhere in the app.',
      'Typing indicators and online status, which are broadcast live and never written down.',
      'The content of calls. Voice and video go directly between devices.',
    ],
  },
  {
    id: 'ephemeral',
    title: 'Things that are deleted',
    body: [
      'Pings are opened a fixed number of times. Once the views are spent, the path to the media is cleared and the file is removed from storage - the row survives in the conversation so the thread makes sense, but the picture is gone.',
      'Stories expire 24 hours after posting.',
      'Deleting a message deletes it. Deleting your account removes your profile, messages, media and connections.',
    ],
  },
  {
    id: 'security',
    title: 'How it is protected',
    body: [
      'Every connection uses HTTPS. Data is encrypted at rest in the database and in file storage.',
      'Access is enforced at the database itself, not just in the app. Every table has row-level security, so a request for somebody else’s messages is refused by the database even if the app asked for it. That is the difference between a rule and a check.',
      'Calls are peer-to-peer and encrypted by WebRTC. When two devices cannot reach each other directly, the connection falls back to a relay server, which passes the encrypted packets along without being able to read them.',
    ],
  },
  {
    id: 'third-parties',
    title: 'Who else touches your data',
    body: ['Three, and each only for what it says.'],
    list: [
      'Supabase runs the database, authentication, file storage and the realtime connection. Your data lives on their infrastructure.',
      'Cloudflare Pages serves the app and sees the IP address of every request, as any web host does.',
      'Google, in one case only: if you choose to sign in with a Google account. Nothing else in PINGO contacts Google.',
      'jsDelivr, a public CDN, serves the emoji and sticker artwork. It receives an IP address when those images load. Self-hosting them is the same job already done for the typeface and the camera models, and it is next.',
    ],
  },
  {
    id: 'moved',
    title: 'Things that used to be third parties',
    body: [
      'Two contacts have been removed rather than disclosed, because the better answer to "who else sees this?" is "nobody".',
      'The typeface came from Google Fonts, so Google received an IP address for every visitor on every cold load - before sign-in, before anything. It is now served from PINGO’s own servers.',
      'The camera’s face, hand and gesture tracking downloaded its models from Google, so turning on a filter announced itself. Those forty megabytes now come from PINGO too. The tracking always ran on your device and no image ever left it; what left was a request saying somebody was about to use a filter, which was a small thing to leak and an unnecessary one.',
    ],
  },
  {
    id: 'control',
    title: 'What you control',
    body: [
      'Privacy settings decide who can find you, who can see your stories and who may message you. Blocking someone stops all of it at the database, not just in the interface.',
      'You can delete any message, remove a story, replace a post or delete your account outright, at any time, without asking us.',
      'If you want a copy of your data or want it erased and cannot do it from the app, ask through the Help screen.',
    ],
  },
  {
    id: 'children',
    title: 'Children',
    body: [
      'PINGO is not for anybody under 13. If we learn that an account belongs to a child under 13, we remove it.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes',
    body: [
      'If this policy changes in a way that materially affects you, we will say so in the app rather than quietly editing this page. The date at the top is always the current version.',
    ],
  },
];

export function PrivacyPolicyScreen() {
  const navigate = useNavigate();
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  useEffect(
    () =>
      applyPageSeo({
        title: 'Privacy Policy - PINGO',
        description:
          'Privacy Policy for PINGO: what we collect, how messages and media are handled, and who can access your account data. Written from the live product schema.',
        path: '/privacy',
        type: 'article',
      }),
    [],
  );

  return (
    <div className="h-full overflow-y-auto bg-page">
      <header
        className={cn(
          'sticky top-0 z-100 flex items-center gap-1',
          'glass-surface border-x-0 border-t-0 border-b-line',
          'px-3 pt-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]',
        )}
      >
        <IconButton label="Back" variant="ghost" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={22} />
        </IconButton>
        <h1 className="text-h2 text-ink">Privacy Policy</h1>
      </header>

      <main>
        <article className="mx-auto w-full max-w-2xl px-5 pt-8 pb-24">
          <p className="text-caption text-text-tertiary">Last updated {UPDATED}</p>

          <div className="mt-8 flex flex-col gap-8">
            {SECTIONS.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-24"
                aria-labelledby={`privacy-${section.id}`}
              >
                <h2 id={`privacy-${section.id}`} className="text-h2 text-ink">
                  {section.title}
                </h2>

                <div className="mt-2 flex flex-col gap-2">
                  {section.body.map((paragraph) => (
                    <p key={paragraph} className="text-body text-text-secondary">
                      {paragraph}
                    </p>
                  ))}
                </div>

                {section.list && (
                  <ul className="mt-3 flex flex-col gap-2">
                    {section.list.map((item) => (
                      <li key={item} className="flex gap-2.5 text-body text-text-secondary">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <footer className="mt-12 border-t border-line pt-6">
            <nav aria-label="Related policies" className="flex flex-wrap gap-x-5 gap-y-2">
              <Link
                to="/terms"
                className="text-caption text-brand underline-offset-2 hover:underline"
              >
                Terms of Use
              </Link>
              <Link
                to="/download"
                className="text-caption text-brand underline-offset-2 hover:underline"
              >
                Download PINGO
              </Link>
            </nav>
            <p className="mt-4 text-caption text-text-tertiary">
              The{' '}
              <Link to="/terms" className="text-brand underline-offset-2 hover:underline">
                Terms of Use
              </Link>{' '}
              cover the rest. After you sign in, Privacy settings in the app is where you change
              who can see what.
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}

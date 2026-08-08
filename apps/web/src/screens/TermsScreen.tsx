import { ChevronLeftIcon, IconButton, cn } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { applyPageSeo } from '../lib/seo.js';

/**
 * Terms of use.
 *
 * ## Public, and it has to be
 *
 * The download page links here, and that page is for people who do not have an
 * account yet. Terms behind a sign-in wall are terms nobody can read before
 * agreeing to them, which defeats the point of having them.
 *
 * ## Written to be read
 *
 * Plain sentences, short sections, no defined-term glossary. Everything here
 * describes what PINGO actually does - the view limits, the 24-hour expiry, the
 * three-post shelf, the mutual-follow rule - rather than the generic clauses a
 * template would supply for features this product does not have.
 *
 * Encryption is stated as the product actually works: human chats are
 * end-to-end encrypted for message bodies; PINGO AI is not, because the
 * assistant must process text. Privacy Policy has the full map.
 */

const UPDATED = '8 August 2026';

interface Section {
  /** Anchor target, so the download page can link straight to a section. */
  id: string;
  title: string;
  body: string[];
}

const SECTIONS: Section[] = [
  {
    id: 'summary',
    title: 'The short version',
    body: [
      'PINGO is free. You own what you post. We do not sell your data or show you advertising. Human chats use end-to-end encryption for message bodies; PINGO AI is not E2EE because it must read your words to reply. The Privacy Policy explains both in detail.',
      'If you break the rules below, we may suspend or remove your account.',
    ],
  },
  {
    id: 'using',
    title: 'Using PINGO',
    body: [
      'You must be at least 13 years old to use PINGO, and old enough to agree to these terms where you live.',
      'You are responsible for what happens on your account, including keeping your sign-in details to yourself. Tell us if you think someone else has access to it.',
      'One person, one account. Accounts are not transferable.',
    ],
  },
  {
    id: 'conduct',
    title: 'What you may not do',
    body: [
      'Harass, threaten, impersonate or stalk anybody.',
      'Post sexual content involving minors, or anything that sexualises a child. This results in an immediate permanent ban and a report to the relevant authorities.',
      'Share content you do not have the right to share.',
      'Use PINGO to distribute malware, spam or scams.',
      'Attempt to break, overload or reverse-engineer the service, or access accounts and data that are not yours.',
      'Scrape or automate the service, including collecting profiles or media in bulk.',
    ],
  },
  {
    id: 'content',
    title: 'Your content',
    body: [
      'What you post stays yours. You give PINGO only the permission it needs to run the service, to store your messages, show them to the people you sent them to, and resize images so they load quickly.',
      'That permission ends when the content does. Delete a message and we delete it; leave the service and your content goes with you.',
    ],
  },
  {
    id: 'ephemeral',
    title: 'Things that disappear',
    body: [
      'Pings are opened a fixed number of times: once, twice, or kept in the chat if the sender chose that. Once the views are spent the media is unreachable and the file is deleted from our storage.',
      'Stories expire 24 hours after posting and are then removed.',
      'We cannot promise that a recipient has not photographed their screen. Nothing on any platform can. Send accordingly.',
    ],
  },
  {
    id: 'data',
    title: 'How your data is handled',
    body: [
      'Everything travels over HTTPS. Voice and video calls use WebRTC encryption between devices; a relay may help connect you without keeping a recording of the call.',
      'Human direct and group message bodies are end-to-end encrypted on your devices before they are stored. The server holds ciphertext for those bodies, plus the metadata and media files the product needs to deliver chat.',
      'PINGO AI chats are not end-to-end encrypted. The assistant processes your AI messages on our systems and with our model provider so it can reply. AI memories exist only when you explicitly save them.',
      'We do not sell personal data, and there is no advertising on PINGO.',
      'The Privacy Policy sets out exactly what is held, what is not, who else processes data, and answers common questions.',
    ],
  },
  {
    id: 'ai',
    title: 'PINGO AI',
    body: [
      'PINGO AI is an optional assistant inside the app. It is not a human recipient and it is not an E2EE sealed chat.',
      'Do not send passwords, recovery secrets, or material you need the server never to see into AI chat. Use human chats for private conversation with people.',
      'You remain responsible for what you ask the assistant to do when it affects other people or breaks the conduct rules above.',
    ],
  },
  {
    id: 'groups',
    title: 'Groups and invite links',
    body: [
      'You can only be added to a group directly by somebody you follow mutually. Anyone else needs an invite link, which an admin creates and can revoke at any time.',
      'A group admin can add and remove members, rename the group, and make other members admins. If the last admin leaves, the longest-standing remaining member becomes one, so a group is never left without anyone able to manage it.',
    ],
  },
  {
    id: 'availability',
    title: 'Availability',
    body: [
      'PINGO is provided as it is. We aim to keep it running and we do not guarantee it will be available without interruption, or that it will never lose data.',
      'The service changes. Features may be added, altered or removed.',
    ],
  },
  {
    id: 'ending',
    title: 'Ending your account',
    body: [
      'You can stop using PINGO at any time, and uninstalling the app removes the local copy without touching your account.',
      'We may suspend or end an account that breaks these terms, or where we are required to by law.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: [
      'If these terms change in a way that materially affects you, we will say so in the app rather than quietly updating this page. The date at the top always reflects the current version.',
    ],
  },
];

export function TermsScreen() {
  const navigate = useNavigate();
  const { hash } = useLocation();

  /*
   * React Router does not honour a hash on its own.
   *
   * The download page links to /terms#data, and without this the visitor lands
   * at the top of a long document with no indication that a particular section
   * was meant -- which reads as a broken link rather than a slow one.
   */
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  useEffect(
    () =>
      applyPageSeo({
        title: 'Terms of Use | PINGO',
        description:
          'Terms of Use for PINGO: private messaging, disappearing Pings, expiring stories, and a three-post profile shelf. Read before you create an account.',
        path: '/terms',
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
        <h1 className="text-h2 text-ink">Terms of Use</h1>
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
                aria-labelledby={`terms-${section.id}`}
              >
                <h2 id={`terms-${section.id}`} className="text-h2 text-ink">
                  {section.title}
                </h2>
                <div className="mt-2 flex flex-col gap-2">
                  {section.body.map((paragraph) => (
                    <p key={paragraph} className="text-body text-text-secondary">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="mt-12 border-t border-line pt-6">
            <nav aria-label="Related policies" className="flex flex-wrap gap-x-5 gap-y-2">
              <Link
                to="/privacy"
                className="text-caption text-brand underline-offset-2 hover:underline"
              >
                Privacy Policy
              </Link>
              <Link
                to="/download"
                className="text-caption text-brand underline-offset-2 hover:underline"
              >
                Download PINGO
              </Link>
            </nav>
            <p className="mt-4 text-caption text-text-tertiary">
              For what is collected and who else touches it, read the{' '}
              <Link to="/privacy" className="text-brand underline-offset-2 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}

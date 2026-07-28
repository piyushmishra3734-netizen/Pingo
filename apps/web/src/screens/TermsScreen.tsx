import { ChevronLeftIcon, IconButton, cn } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

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
 * describes what PINGO actually does — the view limits, the 24-hour expiry, the
 * three-post shelf, the mutual-follow rule — rather than the generic clauses a
 * template would supply for features this product does not have.
 *
 * The encryption section says what is true rather than what sounds best:
 * messages are encrypted in transit and at rest but are **not** end-to-end
 * encrypted, so PINGO can technically read them. Saying so here is the whole
 * reason a page like this is worth writing.
 */

const UPDATED = '28 July 2026';

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
      'PINGO is free. You own what you post. We do not sell your data or show you advertising. Messages are private between the people in a conversation, but they are not end-to-end encrypted yet — the section on data below explains exactly what that means.',
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
      'What you post stays yours. You give PINGO only the permission it needs to run the service — to store your messages, show them to the people you sent them to, and resize images so they load quickly.',
      'That permission ends when the content does. Delete a message and we delete it; leave the service and your content goes with you.',
    ],
  },
  {
    id: 'ephemeral',
    title: 'Things that disappear',
    body: [
      'Pings are opened a fixed number of times — once, twice, or kept in the chat if the sender chose that. Once the views are spent the media is unreachable and the file is deleted from our storage.',
      'Stories expire 24 hours after posting and are then removed.',
      'We cannot promise that a recipient has not photographed their screen. Nothing on any platform can. Send accordingly.',
    ],
  },
  {
    id: 'data',
    title: 'How your data is handled',
    body: [
      'Everything travels over HTTPS. Voice and video calls are peer-to-peer and encrypted by WebRTC — the media does not pass through our servers at all.',
      'Messages, photos and voice notes are encrypted in transit and encrypted at rest on our database. They are not end-to-end encrypted, which means PINGO could technically read them. We do not, and there is no process that does — but we would rather state the limit plainly than let the word "encrypted" imply something stronger than what is built.',
      'We do not sell personal data, and there is no advertising on PINGO.',
      'You can control who finds you, who can see your stories and who may message you in Privacy settings.',
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

  useEffect(() => {
    const title = document.title;
    document.title = 'Terms of Use — PINGO';
    return () => {
      document.title = title;
    };
  }, []);

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

      <article className="mx-auto w-full max-w-2xl px-5 pt-8 pb-24">
        <p className="text-caption text-text-tertiary">Last updated {UPDATED}</p>

        <div className="mt-8 flex flex-col gap-8">
          {SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-h2 text-ink">{section.title}</h2>
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
          <p className="text-caption text-text-tertiary">
            Questions about any of this? The{' '}
            <Link to="/settings/help" className="text-brand underline-offset-2 hover:underline">
              Help screen
            </Link>{' '}
            has what support needs to answer them.
          </p>
        </footer>
      </article>
    </div>
  );
}

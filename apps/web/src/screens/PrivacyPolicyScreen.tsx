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
 * it.
 *
 * ## Written from the live product
 *
 * Human DMs use client-side end-to-end encryption. PINGO AI cannot, by design.
 * Pings, stories, profiles, calls, push, backup and onboarding assets are
 * described as they actually work — not as a generic template.
 */

const UPDATED = '8 August 2026';

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
      'PINGO is a private messaging product. There is no advertising, no data brokering, and no analytics SDK built to profile you.',
      'Human chats (direct messages and groups between people) are designed so message bodies leave your device as ciphertext. We call that end-to-end encryption for human chat. The server stores ciphertext, delivery metadata, and media files needed to deliver the product.',
      'PINGO AI is different on purpose: the assistant must read what you type to reply. AI chats, AI memories you save, and the model provider that generates replies are not end-to-end encrypted.',
      'This page is the honest map. Privacy settings inside the app control who can find you and contact you; this document explains what exists on servers and devices.',
    ],
  },
  {
    id: 'collected',
    title: 'What PINGO holds',
    body: [
      'Everything below exists because a feature needs it. Nothing is kept only to build an advertising profile.',
    ],
    list: [
      'Account: email and/or phone (when you use them), password stored only as a secure hash, or Google sign-in identifiers if you choose Google. Username login resolves your handle without exposing your email in error messages.',
      'Profile: username, display name, avatar, bio, and profile presentation fields the product shows (including display counts where the product uses them).',
      'Human messages: ciphertext for text and structured message kinds, plus metadata the app needs (sender, conversation, time, kind, reply targets, edit/delete state, reactions). Recipients decrypt on their devices with keys that stay on devices.',
      'Message media: Pings (disappearing chat photos), chat photos, voice notes, documents, and similar attachments stored as files so the other person can open them. Access is limited by account rules; files are not a public gallery.',
      'Delivery and read state: how far each person has read, mute/pin/archive preferences, and chat-list organisation.',
      'Stories: media, caption, audience rules, expiry, and view activity the product shows.',
      'Posts: up to three on a profile, with captions and social counts the product displays (likes, comments where enabled).',
      'Social graph: follows and follow requests, blocks, and mutual connections used for messaging and discovery rules.',
      'Groups: membership, roles, invite codes, and group messages under the same encryption model as other human chats.',
      'Calls: who called whom, when, and duration for history. Call audio and video are not recorded by PINGO. Media is WebRTC between devices; a relay may carry encrypted packets when direct connection fails.',
      'Device keys: public keys for your devices so others can encrypt to you. Private keys are generated and kept on the device (and in recovery material you choose to create).',
      'Secure backup / recovery: if you enable it, encrypted backup packages and recovery helpers you set up so a new device can restore history. We cannot usefully read a correctly sealed backup as chat plaintext.',
      'Push tokens: device tokens so we can send notifications. Notification payloads are kept minimal (who / what kind); full message text is not required for delivery.',
      'PINGO AI: AI conversation membership, plaintext of AI threads (required to generate replies), and AI memories only when you explicitly save them. Model inference is performed by our AI provider under our account.',
      'Product chrome: splash and intro artwork published for everyone, public legal pages, and basic server logs needed to run and secure the service (for example connection metadata on the host).',
      'On your device: local databases and caches so chats feel instant offline or on slow networks. Clearing app data or site storage removes that local copy.',
    ],
  },
  {
    id: 'encryption',
    title: 'Encryption: human chat vs AI',
    body: [
      'Human direct messages and human group messages are end-to-end encrypted for message bodies: your device encrypts before upload; other people\'s devices decrypt. PINGO operators and the database see ciphertext for those bodies, not readable chat text, under normal operation.',
      'Metadata still exists so the product works: who is in a conversation, timestamps, message kind, delivery and read markers, and pointers to media files. Metadata is not the same as reading the sealed body.',
      'Chat media (Pings, voice notes, photos, files) is stored so recipients can open it. It is protected by account and storage rules and HTTPS; it is not the same construction as sealing a text body with your device keys. Treat sensitive photos and voice as sensitive even inside a chat.',
      'PINGO AI cannot be end-to-end encrypted: the assistant must process your words. AI chat content and AI memories are processed on our systems and by the model provider. Do not put secrets in AI chat that you would not trust a server-side assistant with.',
      'Everything between your app and our infrastructure uses HTTPS. Passwords are hashed. Database access is constrained with row-level security so one account cannot simply request another account\'s rows.',
    ],
  },
  {
    id: 'notheld',
    title: 'What PINGO does not hold (or does not keep)',
    body: [],
    list: [
      'Your phone address book. PINGO does not upload contacts for ranking or ads.',
      'Continuous background location. Location is only stored if you deliberately send a location message (or similar explicit share).',
      'Advertising IDs for resale, third-party ad pixels, or behavioural ad profiles.',
      'A product analytics stack whose job is to build a marketing dossier of you. Operational logs may exist to keep the service up and secure; they are not an ad graph.',
      'The content of live calls as a recording. PINGO does not keep a tape of your voice or video call.',
      'Readable plaintext of human E2EE message bodies on the server under normal design (ciphertext is what is stored for those bodies).',
    ],
  },
  {
    id: 'ephemeral',
    title: 'Things that expire or disappear',
    body: [
      'Pings are limited-view chat media. When views are spent or the Ping is consumed, the media path is cleared so it cannot be opened again through the product. Thread history may still show that a Ping was sent.',
      'Stories expire about 24 hours after posting and are then removed from the live product surface.',
      'Deleting a message removes it according to the product rules for that conversation (including tombstones or cleared bodies where the UI needs them).',
      'Intro and splash art are product assets, not your private chat. Changing them updates what everyone sees after launch.',
      'Account deletion as a one-tap self-serve flow may still be incomplete. If you need an account removed, email the address at the bottom of this page and we will handle it. Until self-serve deletion is finished, that is the honest path.',
    ],
  },
  {
    id: 'ai',
    title: 'PINGO AI',
    body: [
      'PINGO AI is an in-app assistant in a separate conversation type from human E2EE chats.',
      'To answer you, the service sends recent AI-thread context (and any memories you explicitly saved) to our systems and the model provider. That content is processed to produce the reply.',
      'AI memories are not harvested automatically from everything you type. They are stored when you ask the product to remember something (or use an explicit memory action the product provides).',
      'Do not use AI chat for passwords, recovery secrets, or anything you need the server never to see. Use human E2EE chat with people for private human conversation; use AI with that limit in mind.',
    ],
  },
  {
    id: 'devices',
    title: 'Devices, local data and backup',
    body: [
      'PINGO is local-first where it can be: recent chats and keys live on the device so opening the app is fast and partly works offline.',
      'A new device does not magically receive old human ciphertext it cannot decrypt. Restoring history depends on signing in and, when you use it, Secure Backup / recovery you set up.',
      'If you lose every device and every recovery path, sealed human history may be unrecoverable. That is a consequence of E2EE, not a hidden server vault of plaintext.',
      'Uninstalling the app or clearing site data removes local copies on that device. It does not by itself delete the server account.',
    ],
  },
  {
    id: 'security',
    title: 'How access is protected',
    body: [
      'HTTPS for network traffic. Hashed passwords. Session tokens for signed-in requests.',
      'Row-level security on application tables so authorization is enforced in the database, not only in the user interface.',
      'Private media buckets are not a free-for-all: reads are constrained so random accounts should not list other people\'s private chat files. Public surfaces (avatars, published splash/intro art, public profile content you chose to show) are intentionally visible.',
      'Calls use WebRTC encryption between peers; TURN relays, when used, forward packets for connectivity without being designed as a recording service.',
      'No security system is perfect. We work to fix issues responsibly. Do not attempt to break into accounts that are not yours.',
    ],
  },
  {
    id: 'third-parties',
    title: 'Who else may process data',
    body: [
      'Infrastructure partners process data only to run PINGO — not to sell your chats as a product.',
    ],
    list: [
      'Supabase: database, auth, file storage, realtime. Your account and app data live on this infrastructure under our project.',
      'Cloudflare: hosts the web app (and related edge delivery). Like any host, it sees connection metadata such as IP addresses for requests it serves. Cloudflare may also provide call relay (TURN) credentials so calls connect on hard networks.',
      'Google: only if you use Google sign-in, and/or if you enable push notifications that use Firebase Cloud Messaging / browser push libraries. Push content is kept minimal; we do not need FCM to store your full chat history.',
      'AI model provider: processes AI-chat prompts and context to generate assistant replies. Human E2EE DM bodies are not sent there for ordinary human chat.',
      'App stores / OS vendors: if you install a native build, their normal install and update channels apply under their policies.',
    ],
  },
  {
    id: 'control',
    title: 'What you control',
    body: [
      'In-app Privacy settings: who can find you, message you, call you, and related visibility choices the product exposes.',
      'Blocking: stops further contact according to product rules, enforced in data access where implemented.',
      'Content you send: delete messages, remove stories, replace profile posts where the product allows.',
      'AI memories: only what you explicitly save; you should be able to clear or stop saving memories as the product UI provides.',
      'Notifications: system permission plus in-app notification preferences.',
      'Secure Backup: optional; you choose whether to create recovery material.',
      'Copies and erasure requests: email piyushmishra3734@gmail.com. We will respond as required by applicable law and as the product allows us to fulfil.',
    ],
  },
  {
    id: 'children',
    title: 'Children',
    body: [
      'PINGO is not directed at children under 13. If we learn an account belongs to a child under 13, we will remove it.',
      'If local law sets a higher digital consent age, you must meet that age to use the service.',
    ],
  },
  {
    id: 'questions',
    title: 'Questions people actually ask',
    body: [],
    list: [
      'Can PINGO staff read my human DMs? Under the E2EE design, message bodies are ciphertext on the server. Staff are not meant to read your private human chat as plaintext. Metadata and some media handling still exist for delivery.',
      'Can PINGO staff read my AI chat? Yes, in principle — AI requires server-side processing. Treat AI chat as assistant processing, not as a sealed human DM.',
      'Are Pings private forever? No. They are limited-view media. Screenshots and screen recording by a recipient are outside any app\'s full control.',
      'If I log out, is my data deleted? No. Logout ends the session on that device. Your account and server-held data remain until you delete or request erasure.',
      'If I get a new phone, do old chats appear automatically? Not always. Local history and E2EE keys live on devices. Use Secure Backup / recovery when you want a deliberate restore path.',
      'Do you sell my data? No.',
      'Is there advertising? No ads in the product today.',
      'Who sees my profile? Username and public profile fields are part of a social messaging product. Use Privacy settings and blocking for finer control.',
      'What about voice notes and photos in chat? They are stored so the recipient can open them, under account rules. Prefer not to send highly sensitive media if your threat model requires zero server-held files.',
      'What law applies / where do I complain? Contact us at the email below first. Depending on where you live, local consumer or data-protection authorities may also apply.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes',
    body: [
      'If this policy changes in a way that materially affects you, we will say so in the product when we can, rather than only editing this page in silence. The date at the top is the current version.',
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    body: [
      'Privacy and data requests: piyushmishra3734@gmail.com',
      'Related: Terms of Use describe acceptable use, Pings, stories, groups, and account rules. In-app Privacy settings control day-to-day visibility after you sign in.',
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
        title: 'Privacy Policy | PINGO',
        description:
          'PINGO Privacy Policy: end-to-end encrypted human chats, PINGO AI processing limits, Pings, stories, backup, push, and what we store. Written from the live product.',
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
              cover acceptable use and product rules. After you sign in, Privacy settings is where
              you change who can see what day to day.
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}

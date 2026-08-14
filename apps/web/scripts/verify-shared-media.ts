/**
 * What the media/docs/links sheet is allowed to show.
 *
 * Most of this is bucketing and could be read off the source. One rule cannot:
 * a photo sent with a view limit must never appear in a gallery, because a
 * limit a second screen ignores is not a limit. That is a promise to the
 * sender, so it is asserted here rather than left to a code review.
 *
 * Run with `pnpm verify:shared-media`.
 */
import assert from 'node:assert/strict';
import type { Message } from '@pingo/core';

import { collectSharedMedia } from '../src/features/chat/shared-media.js';

const base = {
  conversationId: 'c1',
  authorId: 'u1',
  status: 'sent' as const,
  attachments: [],
  reactions: [],
};

const messages: Message[] = [
  {
    ...base,
    id: 'm1',
    body: '',
    createdAt: 100,
    photo: { url: 'https://example.test/keep.jpg' },
  },
  {
    ...base,
    id: 'm2',
    body: '',
    createdAt: 200,
    // Sent to be seen twice and then gone.
    photo: { url: 'https://example.test/spent.jpg', viewLimit: 2 },
  },
  {
    ...base,
    id: 'm3',
    body: 'the deck is at https://example.test/deck and notes.pingo.app',
    createdAt: 300,
  },
  {
    ...base,
    id: 'm4',
    body: '',
    createdAt: 400,
    attachments: [
      {
        id: 'a1',
        kind: 'file',
        url: 'https://example.test/rent.pdf',
        fileName: 'rent.pdf',
        mimeType: 'application/pdf',
        size: 2048,
      },
      { id: 'a2', kind: 'video', url: 'https://example.test/clip.mp4', width: 2, height: 1, duration: 4 },
      // Voice notes are not gallery material.
      { id: 'a3', kind: 'audio', url: 'https://example.test/note.wav', duration: 3, waveform: [] },
    ],
  },
  {
    ...base,
    id: 'm5',
    body: '',
    createdAt: 500,
    deleted: true,
    attachments: [{ id: 'a4', kind: 'image', url: 'https://example.test/gone.jpg', width: 1, height: 1 }],
  },
  {
    ...base,
    id: 'm6',
    body: '',
    createdAt: 600,
    ping: { expiresAt: 9e12, gone: false, views: 1 },
  },
  {
    ...base,
    id: 'm7',
    body: 'https://example.test/secret',
    createdAt: 700,
    // Sent under a timer that has since run out. The sheet reads the disk
    // directly, so nothing upstream has filtered this one for it.
    expiresAt: 900,
    photo: { url: 'https://example.test/expired.jpg' },
  },
];

const NOW = 1000;
const found = collectSharedMedia(messages, NOW);

// The expired message contributes neither its photo nor its link.
assert.equal(
  found.media.some((item) => item.messageId === 'm7'),
  false,
  'a message past its timer must not reach the gallery',
);
assert.equal(
  found.links.some((link) => link.messageId === 'm7'),
  false,
);

// Still there while the timer is running.
assert.equal(collectSharedMedia(messages, 800).media.some((i) => i.messageId === 'm7'), true);

// The limited photo, the Ping and the deleted picture are all absent; the
// unlimited photo and the video are both present.
assert.deepEqual(
  found.media.map((item) => item.messageId),
  ['m4', 'm1'],
);
assert.equal(
  found.media.some((item) => item.url?.includes('spent')),
  false,
  'a view-limited photo must never reach the gallery',
);

// Newest first, everywhere.
assert.deepEqual(
  found.media.map((item) => item.createdAt),
  [400, 100],
);

// Documents keep what a row needs; the voice note is not one of them.
assert.equal(found.docs.length, 1);
assert.equal(found.docs[0]?.fileName, 'rent.pdf');
assert.equal(found.docs[0]?.size, 2048);

// Both a full URL and a bare domain count, and a bare one gets a scheme.
assert.deepEqual(
  found.links.map((link) => link.href),
  ['https://example.test/deck', 'https://notes.pingo.app'],
);

console.log('shared media: ok');

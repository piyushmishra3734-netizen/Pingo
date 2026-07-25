/**
 * Seed data.
 *
 * These are the exact people and conversations shown on the branding board, so
 * the running app and the board can be compared side by side. Times are anchored
 * to *today* rather than hard-coded dates, so the list always reads as live.
 *
 * Avatars are intentionally absent: `Avatar` falls back to a deterministic
 * brand-gradient monogram. That keeps the repo free of bundled stock photos and
 * of hotlinks to third-party avatar services, and the monogram is the treatment
 * real users will see before they upload a picture anyway.
 */

import type {
  AppNotification,
  AudioAttachment,
  CallRecord,
  Conversation,
  CurrentUser,
  GalleryItem,
  Message,
  Moment,
  User,
} from './types.js';

/** Epoch ms for a wall-clock time today, e.g. `todayAt(11, 30)`. */
function todayAt(hour: number, minute: number): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Same, offset by whole days into the past. */
function daysAgoAt(days: number, hour: number, minute: number): number {
  return todayAt(hour, minute) - days * 24 * 60 * 60 * 1000;
}

/**
 * A believable voice-note envelope: speech rises, dips at a breath, then trails
 * off. Random noise would look like static rather than a human talking.
 */
function speechWaveform(bars: number): number[] {
  return Array.from({ length: bars }, (_, i) => {
    const t = i / (bars - 1);
    const envelope = Math.sin(t * Math.PI) ** 0.6;
    const breath = 1 - 0.45 * Math.exp(-(((t - 0.52) / 0.06) ** 2));
    const texture = 0.72 + 0.28 * Math.sin(i * 2.1) * Math.cos(i * 0.7);
    return Math.max(0.12, Math.min(1, envelope * breath * texture));
  });
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const currentUser: CurrentUser = {
  id: 'u-me',
  name: 'Piyush Mishra',
  handle: 'piyush',
  bio: 'Building calm software.',
  presence: { state: 'online', lastSeenAt: Date.now() },
  settings: {
    appearance: 'light',
    notifications: {
      messages: true,
      calls: true,
      mentions: true,
      quietHours: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    },
    privacy: {
      presenceVisibility: 'contacts',
      readReceipts: true,
      typingIndicators: true,
      lastSeen: true,
    },
    reducedMotion: false,
  },
};

export const users: User[] = [
  {
    id: 'u-anaya',
    name: 'Anaya Sharma',
    handle: 'anaya',
    bio: 'Product designer. Tea, typography, long walks.',
    presence: { state: 'online', lastSeenAt: Date.now() },
  },
  {
    id: 'u-rohit',
    name: 'Rohit Verma',
    handle: 'rohit',
    bio: 'Backend engineer.',
    presence: { state: 'online', lastSeenAt: Date.now() - 4 * 60 * 1000 },
  },
  {
    id: 'u-kabir',
    name: 'Kabir Singh',
    handle: 'kabir',
    bio: 'Photographer.',
    presence: { state: 'offline', lastSeenAt: daysAgoAt(1, 21, 12) },
  },
  {
    id: 'u-alex',
    name: 'Alex Fernandes',
    handle: 'alex',
    bio: 'Design lead.',
    presence: { state: 'away', lastSeenAt: Date.now() - 32 * 60 * 1000 },
  },
  {
    id: 'u-meera',
    name: 'Meera Iyer',
    handle: 'meera',
    bio: 'Researcher.',
    presence: { state: 'online', lastSeenAt: Date.now() },
  },
];

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const anayaVoiceNote: AudioAttachment = {
  id: 'att-voice-1',
  kind: 'audio',
  url: '',
  duration: 12,
  waveform: speechWaveform(42),
};

/** Keyed by conversation, newest last. */
export const messagesByConversation: Record<string, Message[]> = {
  'c-anaya': [
    {
      id: 'm-a1',
      conversationId: 'c-anaya',
      authorId: 'u-anaya',
      body: 'Hey! Where are we meeting?',
      createdAt: todayAt(11, 30),
      status: 'read',
      attachments: [],
      reactions: [],
    },
    {
      id: 'm-a2',
      conversationId: 'c-anaya',
      authorId: 'u-me',
      body: 'See you there!',
      createdAt: todayAt(11, 30),
      status: 'read',
      attachments: [],
      reactions: [],
    },
    {
      id: 'm-a3',
      conversationId: 'c-anaya',
      authorId: 'u-anaya',
      body: '',
      createdAt: todayAt(11, 31),
      status: 'delivered',
      attachments: [anayaVoiceNote],
      reactions: [],
    },
  ],
  'c-rohit': [
    {
      id: 'm-r1',
      conversationId: 'c-rohit',
      authorId: 'u-me',
      body: 'Pushed the auth changes — can you take a look when you get a minute?',
      createdAt: todayAt(10, 12),
      status: 'read',
      attachments: [],
      reactions: [],
    },
    {
      id: 'm-r2',
      conversationId: 'c-rohit',
      authorId: 'u-rohit',
      body: 'Looking now.',
      createdAt: todayAt(10, 40),
      status: 'read',
      attachments: [],
      reactions: [{ emoji: '👍', userIds: ['u-me'] }],
    },
    {
      id: 'm-r3',
      conversationId: 'c-rohit',
      authorId: 'u-rohit',
      body: 'Where are we meeting?',
      createdAt: todayAt(10, 45),
      status: 'delivered',
      attachments: [],
      reactions: [],
    },
  ],
  'c-design': [
    {
      id: 'm-d1',
      conversationId: 'c-design',
      authorId: 'u-meera',
      body: 'Research notes from yesterday are in the doc.',
      createdAt: todayAt(9, 2),
      status: 'read',
      attachments: [],
      reactions: [],
    },
    {
      id: 'm-d2',
      conversationId: 'c-design',
      authorId: 'u-alex',
      body: '',
      createdAt: todayAt(9, 15),
      status: 'delivered',
      attachments: [
        {
          id: 'att-file-1',
          kind: 'file',
          url: '',
          fileName: 'pingo-motion-spec.pdf',
          mimeType: 'application/pdf',
          size: 2_412_000,
        },
      ],
      reactions: [],
    },
  ],
  'c-kabir': [
    {
      id: 'm-k1',
      conversationId: 'c-kabir',
      authorId: 'u-kabir',
      body: '',
      createdAt: daysAgoAt(1, 20, 48),
      status: 'read',
      attachments: [
        {
          id: 'att-voice-2',
          kind: 'audio',
          url: '',
          duration: 24,
          waveform: speechWaveform(42),
        },
      ],
      reactions: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** Last message is denormalised onto the conversation for the list view. */
function lastOf(conversationId: string): Message | undefined {
  const thread = messagesByConversation[conversationId];
  return thread?.[thread.length - 1];
}

export const conversations: Conversation[] = [
  {
    id: 'c-anaya',
    kind: 'direct',
    title: 'Anaya Sharma',
    participantIds: ['u-me', 'u-anaya'],
    lastMessage: lastOf('c-anaya'),
    unreadCount: 0,
    pinned: true,
    muted: false,
    favorite: true,
    typingUserIds: [],
    updatedAt: todayAt(11, 31),
  },
  {
    id: 'c-rohit',
    kind: 'direct',
    title: 'Rohit Verma',
    participantIds: ['u-me', 'u-rohit'],
    lastMessage: lastOf('c-rohit'),
    unreadCount: 2,
    pinned: false,
    muted: false,
    favorite: false,
    typingUserIds: [],
    updatedAt: todayAt(10, 45),
  },
  {
    id: 'c-design',
    kind: 'group',
    title: 'Design Team',
    participantIds: ['u-me', 'u-alex', 'u-meera', 'u-anaya'],
    lastMessage: lastOf('c-design'),
    unreadCount: 1,
    pinned: false,
    muted: false,
    favorite: true,
    typingUserIds: [],
    updatedAt: todayAt(9, 15),
  },
  {
    id: 'c-kabir',
    kind: 'direct',
    title: 'Kabir Singh',
    participantIds: ['u-me', 'u-kabir'],
    lastMessage: lastOf('c-kabir'),
    unreadCount: 0,
    pinned: false,
    muted: true,
    favorite: false,
    typingUserIds: [],
    updatedAt: daysAgoAt(1, 20, 48),
  },
];

// ---------------------------------------------------------------------------
// Calls, gallery, moments, notifications
// ---------------------------------------------------------------------------

export const calls: CallRecord[] = [
  {
    id: 'call-1',
    kind: 'video',
    direction: 'incoming',
    outcome: 'answered',
    withUserId: 'u-anaya',
    startedAt: todayAt(9, 40),
    duration: 1_284,
  },
  {
    id: 'call-2',
    kind: 'voice',
    direction: 'outgoing',
    outcome: 'answered',
    withUserId: 'u-rohit',
    startedAt: daysAgoAt(1, 18, 5),
    duration: 372,
  },
  {
    id: 'call-3',
    kind: 'voice',
    direction: 'incoming',
    outcome: 'missed',
    withUserId: 'u-kabir',
    startedAt: daysAgoAt(2, 14, 22),
    duration: 0,
  },
  {
    id: 'call-4',
    kind: 'video',
    direction: 'outgoing',
    outcome: 'answered',
    conversationId: 'c-design',
    startedAt: daysAgoAt(3, 11, 0),
    duration: 2_940,
  },
];

/**
 * Gallery items use CSS gradients rather than image files — see the note at the
 * top of this file. `url` carries a gradient string the UI renders as a
 * background, which keeps the layout, aspect ratios and interactions fully
 * exercisable without shipping binary assets.
 */
const gradientMedia = (from: string, to: string) =>
  `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;

export const galleryByUser: Record<string, GalleryItem[]> = {
  'u-anaya': [
    {
      id: 'g-1',
      kind: 'image',
      url: gradientMedia('#C9CFFF', '#E7D9FF'),
      width: 1200,
      height: 1600,
      createdAt: daysAgoAt(2, 16, 0),
      caption: 'Morning light',
    },
    {
      id: 'g-2',
      kind: 'image',
      url: gradientMedia('#D8E4FF', '#F0E6FF'),
      width: 1600,
      height: 1200,
      createdAt: daysAgoAt(6, 12, 30),
    },
    {
      id: 'g-3',
      kind: 'video',
      url: gradientMedia('#BFC8FF', '#DCC9FF'),
      width: 1080,
      height: 1080,
      createdAt: daysAgoAt(9, 19, 15),
      caption: 'Studio',
    },
    {
      id: 'g-4',
      kind: 'image',
      url: gradientMedia('#E3E8FF', '#FBEEFF'),
      width: 1200,
      height: 1200,
      createdAt: daysAgoAt(14, 8, 45),
    },
    {
      id: 'g-5',
      kind: 'image',
      url: gradientMedia('#CDD6FF', '#E9DBFF'),
      width: 1200,
      height: 1500,
      createdAt: daysAgoAt(21, 17, 10),
    },
    {
      id: 'g-6',
      kind: 'image',
      url: gradientMedia('#DCE3FF', '#F4E9FF'),
      width: 1500,
      height: 1200,
      createdAt: daysAgoAt(28, 10, 5),
    },
  ],
  'u-me': [
    {
      id: 'g-me-1',
      kind: 'image',
      url: gradientMedia('#D2DAFF', '#EDDFFF'),
      width: 1200,
      height: 1500,
      createdAt: daysAgoAt(4, 15, 20),
      caption: 'Desk, finally tidy',
    },
    {
      id: 'g-me-2',
      kind: 'image',
      url: gradientMedia('#C7D0FF', '#E4D5FF'),
      width: 1400,
      height: 1050,
      createdAt: daysAgoAt(11, 9, 0),
    },
    {
      id: 'g-me-3',
      kind: 'video',
      url: gradientMedia('#DDE4FF', '#F2E7FF'),
      width: 1080,
      height: 1920,
      createdAt: daysAgoAt(18, 20, 40),
    },
  ],
};

export const moments: Moment[] = [
  {
    id: 'mo-1',
    authorId: 'u-anaya',
    media: {
      id: 'mo-m-1',
      kind: 'image',
      url: gradientMedia('#C9CFFF', '#EAD9FF'),
      width: 1080,
      height: 1920,
      createdAt: Date.now() - 3 * 60 * 60 * 1000,
    },
    createdAt: Date.now() - 3 * 60 * 60 * 1000,
    expiresAt: Date.now() + 21 * 60 * 60 * 1000,
    viewedByCurrentUser: false,
  },
  {
    id: 'mo-2',
    authorId: 'u-alex',
    media: {
      id: 'mo-m-2',
      kind: 'image',
      url: gradientMedia('#D6DFFF', '#F1E6FF'),
      width: 1080,
      height: 1920,
      createdAt: Date.now() - 7 * 60 * 60 * 1000,
    },
    createdAt: Date.now() - 7 * 60 * 60 * 1000,
    expiresAt: Date.now() + 17 * 60 * 60 * 1000,
    viewedByCurrentUser: true,
  },
];

export const notifications: AppNotification[] = [
  {
    id: 'n-1',
    kind: 'message',
    title: 'Rohit Verma',
    body: 'Where are we meeting?',
    createdAt: todayAt(10, 45),
    read: false,
    conversationId: 'c-rohit',
  },
  {
    id: 'n-2',
    kind: 'mention',
    title: 'Design Team',
    body: 'Alex mentioned you',
    createdAt: todayAt(9, 15),
    read: false,
    conversationId: 'c-design',
  },
  {
    id: 'n-3',
    kind: 'call',
    title: 'Kabir Singh',
    body: 'Missed voice call',
    createdAt: daysAgoAt(2, 14, 22),
    read: true,
  },
];

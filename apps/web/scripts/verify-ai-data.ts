/**
 * PINGO AI's drawer data: side chats (Recents), goals and the library.
 *
 * Holds to: side chats are never in the chat list but open by id as PINGO
 * AI's room (`kind: 'ai'`); Recents puts the main thread first; a side chat
 * is named from the model's hidden tag or the first words, and never the main
 * thread; goals and the library round-trip through the mock the dev demo uses.
 *
 * Run with `pnpm verify:ai-data`.
 */
import assert from 'node:assert/strict';
import type { ChatEvent, Message } from '@pingo/core';

import { MockChatService } from '../../../packages/core/src/mock-chat-service.js';
import { aiSnippet, messageSnippet, toAiGoal } from '../src/features/ai/ai-recents.js';
import {
  cleanTitle,
  firstWordsTitle,
  sideChatNeedsTitle,
} from '../../../supabase/functions/ai-chat/side-chat-title.ts';

const BOT = 'a1000000-0000-4000-8000-0000000000a1';

// ---- snippets
assert.equal(aiSnippet(undefined), '');
assert.equal(aiSnippet({ body: '**Bold** and `code`\n\n- a [link](https://x.y)', kind: 'text' }), 'Bold and code - a link');
assert.equal(aiSnippet({ body: '', kind: 'photo', sender_id: BOT }, BOT), 'Image');
assert.equal(aiSnippet({ body: '', kind: 'photo', sender_id: 'me' }, BOT), 'Photo');
assert.equal(aiSnippet({ body: '', kind: 'document', file_name: 'plan.pdf' }), 'plan.pdf');
assert.equal(aiSnippet({ body: 'x'.repeat(300), kind: 'text' }).length, 140);
const photoMessage = {
  id: 'm',
  conversationId: 'c',
  authorId: 'me',
  body: '',
  createdAt: 1,
  status: 'sent',
  attachments: [],
  reactions: [],
  photo: { url: 'u' },
} as unknown as Message;
assert.equal(messageSnippet(photoMessage, BOT), 'Photo');
assert.deepEqual(toAiGoal({ id: 'g', title: 'Run', done: true, created_at: '2026-01-01T00:00:00Z', done_at: '2026-01-02T00:00:00Z' }), {
  id: 'g',
  title: 'Run',
  done: true,
  createdAt: Date.parse('2026-01-01T00:00:00Z'),
  doneAt: Date.parse('2026-01-02T00:00:00Z'),
});
console.log('snippets ok');

// ---- titles
assert.equal(cleanTitle('"Learning tennis basics."'), 'Learning tennis basics');
assert.equal(cleanTitle('one two three four five six seven eight'), 'One two three four five six');
assert.equal(cleanTitle('New chat'), undefined);
assert.equal(cleanTitle('  '), undefined);
assert.equal(firstWordsTitle('@pingoai how do I start learning tennis today please'), 'How do I start learning');
assert.equal(firstWordsTitle(''), undefined);
assert.equal(sideChatNeedsTitle({ kind: 'ai', ai_side: true, title: 'New chat' }), true);
assert.equal(sideChatNeedsTitle({ kind: 'ai', ai_side: true, title: null }), true);
assert.equal(sideChatNeedsTitle({ kind: 'ai', ai_side: true, title: 'Tennis' }), false);
assert.equal(sideChatNeedsTitle({ kind: 'ai', ai_side: false, title: 'New chat' }), false, 'main thread never');
assert.equal(sideChatNeedsTitle({ kind: 'ai', title: 'PINGO' }), false, 'before the migration');
assert.equal(sideChatNeedsTitle(null), false);
console.log('titles ok');

// ---- the mock the dev demo runs on
const service = new MockChatService();
const events: ChatEvent[] = [];
service.subscribe((event) => events.push(event));

const mainId = await service.ensureAiConversation();
const list = await service.listConversations();
assert.ok(list.some((c) => c.id === mainId), 'main thread in the chat list');
assert.ok(!list.some((c) => c.aiSide), 'no side chat in the chat list');

let recents = await service.listAiChats();
assert.equal(recents[0]!.id, mainId);
assert.equal(recents[0]!.main, true);
assert.ok(recents.length >= 3, 'main plus the two sample side chats');
assert.ok(recents.slice(1).every((c) => !c.main && c.snippet), 'side chats carry a snippet');
assert.ok(recents[1]!.updatedAt >= recents[2]!.updatedAt, 'newest first after main');

const created = await service.createAiChat();
const announced = events.find((e) => e.type === 'conversation:updated' && e.conversation.id === created);
assert.ok(announced && announced.type === 'conversation:updated' && announced.conversation.aiSide, 'announced as a side chat');
const opened = await service.getConversation(created);
assert.equal(opened?.kind, 'ai', 'opens as PINGO AI\'s room');
assert.equal(opened?.aiChatTitle, 'New chat');
assert.ok(!(await service.listConversations()).some((c) => c.id === created));

await service.renameAiChat(created, '  Weekend   plans ');
recents = await service.listAiChats();
assert.equal(recents.find((c) => c.id === created)?.title, 'Weekend plans');
await assert.rejects(service.renameAiChat(mainId, 'Nope'), 'main thread cannot be renamed');
await service.deleteAiChat(created);
assert.ok(events.some((e) => e.type === 'conversation:removed' && e.conversationId === created));
assert.ok(!(await service.listAiChats()).some((c) => c.id === created));
console.log('side chats ok');

const goal = await service.addAiGoal('  Learn   tennis ');
assert.equal(goal.title, 'Learn tennis');
let goals = await service.listAiGoals();
assert.equal(goals[0]!.id, goal.id, 'newest first');
await service.setAiGoalDone(goal.id, true);
goals = await service.listAiGoals();
assert.ok(goals.find((g) => g.id === goal.id)?.done && goals.find((g) => g.id === goal.id)?.doneAt);
await service.deleteAiGoal(goal.id);
assert.ok(!(await service.listAiGoals()).some((g) => g.id === goal.id));
await assert.rejects(service.addAiGoal(''));
console.log('goals ok');

const library = await service.listAiLibrary();
assert.ok(library.length >= 3);
assert.deepEqual(
  library.map((i) => i.createdAt),
  [...library].map((i) => i.createdAt).sort((a, b) => b - a),
  'newest first',
);
assert.deepEqual(new Set(library.map((i) => i.kind)), new Set(['image', 'photo', 'file']));
const older = await service.listAiLibrary({ before: library[0]!.createdAt });
assert.ok(older.every((i) => i.createdAt < library[0]!.createdAt), 'pages by before');
console.log('library ok');

service.dispose();
console.log('ALL OK');

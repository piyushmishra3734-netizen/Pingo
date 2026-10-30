/**
 * PINGO AI's profile page: the parts with a right answer.
 *
 * - The client: avatars and who may wear them, validation, the row it writes,
 *   and memory import.
 * - The server: the personality and the person's own instructions reach the
 *   chat prompt and the call instructions; the call carries the chosen voice,
 *   speed and language; the voice preview asks for the right thing.
 *
 * Run with `pnpm verify:ai-profile`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AI_AVATARS,
  AI_PERSONAS,
  avatarsIn,
  canUseAvatar,
  clampSpeed,
  parseMemoryImport,
  personaLabel,
  presetFor,
  speedLabel,
  toAiProfileUpsert,
  validateProfile,
  MEMORY_CAP,
} from '../src/features/ai/profile/ai-profile-model.js';
import { instructionsBlock, personalityBlock, profileVoiceBlock } from '../../../supabase/functions/ai-chat/profile-prompt.ts';
import { buildCallInstructions, pickSpeed, pickVoice, previewSpeechBody, realtimeSessionConfig } from '../../../supabase/functions/ai-realtime/session.ts';

let passed = 0;
const ok = (what: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`PASS  ${what}`);
};

ok('ten avatars, unique ids and files, four categories', () => {
  assert.equal(AI_AVATARS.length, 10);
  assert.equal(new Set(AI_AVATARS.map((a) => a.id)).size, 10);
  assert.equal(new Set(AI_AVATARS.map((a) => a.src)).size, 10);
  assert.equal(avatarsIn('all').length, 10);
  assert.deepEqual(avatarsIn('pro').map((a) => a.id), ['headset', 'wizard', 'explorer']);
  assert.equal(avatarsIn('default')[0]!.id, 'classic');
});

ok('Pro avatars need premium; the rest do not', () => {
  const wizard = presetFor('/ai/avatars/wizard.webp')!;
  const star = presetFor('/ai/avatars/star.webp')!;
  assert.equal(canUseAvatar(wizard, false), false);
  assert.equal(canUseAvatar(wizard, true), true);
  assert.equal(canUseAvatar(star, false), true);
  assert.equal(presetFor('https://cdn.example/photo.jpg'), undefined);
});

ok('the database guard lists exactly the Pro avatars', () => {
  // Run from the repo root, as `pnpm verify:ai-profile` does.
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261026000000_ai_profile_page.sql'), 'utf8');
  for (const a of avatarsIn('pro')) assert.ok(sql.includes(`'${a.src}'`), `${a.src} guarded`);
  for (const a of AI_AVATARS.filter((x) => x.category !== 'pro')) assert.ok(!sql.includes(`'${a.src}'`), `${a.src} not guarded`);
  // Every personality the page offers is allowed by the constraint.
  for (const p of AI_PERSONAS) assert.ok(sql.includes(`'${p.id}'`), `${p.id} allowed`);
});

ok('validation: a name is required, lengths are capped', () => {
  assert.deepEqual(validateProfile({ name: 'Pingo', tagline: 'Hi', bio: 'About' }), {});
  assert.ok(validateProfile({ name: '   ', tagline: '', bio: '' }).name);
  assert.ok(validateProfile({ name: 'x'.repeat(41), tagline: '', bio: '' }).name);
  assert.ok(validateProfile({ name: 'P', tagline: 'x'.repeat(51), bio: '' }).tagline);
  assert.ok(validateProfile({ name: 'P', tagline: '', bio: 'x'.repeat(201) }).bio);
  assert.deepEqual(validateProfile({ name: 'P', tagline: 'x'.repeat(50), bio: 'x'.repeat(200) }), {});
});

ok('personas map onto the ids the server knows, and older ones keep a name', () => {
  assert.deepEqual(AI_PERSONAS.map((p) => p.id), ['friendly', 'professional', 'creative', 'concise', 'funny', 'custom']);
  assert.equal(personaLabel('friendly'), 'Default');
  assert.equal(personaLabel('funny'), 'Fun');
  assert.equal(personaLabel('genz'), 'Gen Z');
  assert.equal(personaLabel(undefined), 'Default');
});

ok('speed is clamped to what the call allows', () => {
  assert.equal(clampSpeed(2), 1.3);
  assert.equal(clampSpeed(0.1), 0.7);
  assert.equal(clampSpeed('fast'), 1);
  assert.equal(clampSpeed(1.234), 1.23);
  assert.equal(speedLabel(0.8), 'Slower');
  assert.equal(speedLabel(1), 'Normal');
  assert.equal(speedLabel(1.2), 'Faster');
  assert.equal(pickSpeed(9), 1.3);
  assert.equal(pickSpeed(undefined), 1);
});

ok('the row: trimmed, capped, custom personality follows the instructions', () => {
  const now = new Date('2026-10-13T00:00:00Z');
  const row = toAiProfileUpsert('u1', { display_name: '  Pingo  ', tagline: '  ', bio: 'b'.repeat(250), personality: 'custom', custom_instructions: '  Talk like a pirate  ', voice: 'cedar', voice_speed: 1.1, status: 'dnd' }, now);
  assert.equal(row.display_name, 'Pingo');
  assert.equal(row.tagline, null);
  assert.equal(row.bio!.length, 200);
  assert.equal(row.custom_personality, 'Talk like a pirate');
  assert.equal(row.custom_instructions, 'Talk like a pirate');
  assert.equal(row.status, 'dnd');
  assert.equal(row.voice, 'cedar');
  assert.equal(row.updated_at, now.toISOString());
  const plain = toAiProfileUpsert('u1', { personality: 'professional', custom_personality: 'old', custom_instructions: 'Use bullet points' });
  assert.equal(plain.custom_personality, null);
  assert.equal(plain.custom_instructions, 'Use bullet points');
  assert.equal(plain.memory_enabled, true);
  assert.equal(toAiProfileUpsert('u1', { memory_enabled: false }).memory_enabled, false);
  // The age set on the Personality page reaches the row (it once did not, and never saved).
  assert.equal(toAiProfileUpsert('u1', { age: 19 }).age, 19);
  assert.equal(toAiProfileUpsert('u1', {}).age, null);
});

ok('memory import: lines, bullets, JSON, duplicates and the cap', () => {
  const lines = parseMemoryImport('- My exam is on 4 Nov\n\n* I am vegetarian\n1. Likes chai\nI am vegetarian');
  assert.deepEqual(lines.map((m) => m.value), ['My exam is on 4 Nov', 'I am vegetarian', 'Likes chai']);
  assert.ok(lines.every((m) => m.key.length > 0 && m.key.length <= 80));
  assert.deepEqual(parseMemoryImport('["a", {"value": "b"}, {"text": "c"}, 5]').map((m) => m.value), ['a', 'b', 'c']);
  assert.deepEqual(parseMemoryImport('A\nB', ['a']).map((m) => m.value), ['B']);
  assert.equal(parseMemoryImport(Array.from({ length: 80 }, (_, i) => `m${i}`).join('\n')).length, MEMORY_CAP);
  assert.equal(parseMemoryImport('x\ny\nz', [], 2).length, 2);
  assert.equal(parseMemoryImport('x'.repeat(900))[0]!.value.length, 500);
  assert.deepEqual(parseMemoryImport('   '), []);
});

ok('chat prompt: new personalities have a voice law', () => {
  assert.match(personalityBlock({ personality: 'professional' }), /Professional and focused/);
  assert.match(personalityBlock({ personality: 'concise' }), /Concise above all/);
});

ok('chat prompt: their instructions are sent whatever the personality', () => {
  assert.equal(profileVoiceBlock({ personality: 'friendly' }), '');
  const own = profileVoiceBlock({ personality: 'friendly', custom_instructions: 'Always answer in bullet points' });
  assert.match(own, /THEIR INSTRUCTIONS/);
  assert.match(own, /bullet points/);
  assert.doesNotMatch(own, /VOICE LAW/);
  const both = profileVoiceBlock({ personality: 'concise', custom_instructions: 'Call me boss' });
  assert.match(both, /Concise above all/);
  assert.match(both, /Call me boss/);
  // Custom with the same words is said once, as the voice law.
  const custom = profileVoiceBlock({ personality: 'custom', custom_personality: 'pirate', custom_instructions: 'pirate' });
  assert.match(custom, /VOICE LAW \(CUSTOM\)/);
  assert.equal(instructionsBlock({ personality: 'custom', custom_personality: 'pirate', custom_instructions: 'pirate' }), '');
});

ok('call: instructions, language and voice come from the profile', () => {
  const text = buildCallInstructions({ personality: 'professional', custom_instructions: 'Keep it formal', voice_language: 'hi', language: 'en' }, []);
  assert.match(text, /Professional and focused/);
  assert.match(text, /Keep it formal/);
  assert.match(text, /Speak Hindi/);
  const follow = buildCallInstructions({ language: 'es' }, []);
  assert.match(follow, /preferred language: Spanish/);
  assert.equal(pickVoice('cedar'), 'cedar');
  assert.equal(pickVoice('robot'), 'marin');
});

ok('call: the session carries the speed only when it is not normal', () => {
  const base = { model: 'm', voice: 'marin' as const, instructions: 'i', transcribeModel: 't' };
  const out = (realtimeSessionConfig({ ...base, speed: 1.2 }).session as { audio: { output: Record<string, unknown> } }).audio.output;
  assert.deepEqual(out, { voice: 'marin', speed: 1.2 });
  const normal = (realtimeSessionConfig({ ...base, speed: 1 }).session as { audio: { output: Record<string, unknown> } }).audio.output;
  assert.deepEqual(normal, { voice: 'marin' });
});

ok('voice preview: the voice, the language and the pace', () => {
  const hi = previewSpeechBody('coral', 0.8, 'hi');
  assert.equal(hi.voice, 'coral');
  assert.equal(hi.model, 'gpt-4o-mini-tts');
  assert.match(String(hi.input), /पिंगो/);
  assert.match(String(hi.instructions), /slower/);
  const unknown = previewSpeechBody('marin', 1, 'xx');
  assert.match(String(unknown.input), /I'm Pingo/);
  assert.match(String(unknown.instructions), /natural/);
});

console.log(`\n${passed} passed`);

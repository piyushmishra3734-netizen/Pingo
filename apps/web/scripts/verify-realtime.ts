/**
 * PINGO AI voice calls (OpenAI Realtime): the parts with a right answer.
 *
 * - The transcript, from a recorded run of server events: turns in the order
 *   they were said (their question above the answer even though its
 *   transcript lands later), an interruption marked, empty turns dropped, and
 *   who is talking at each step.
 * - The server half: voice validation, the session body sent to OpenAI, the
 *   instructions, and the cleaning of a transcript before it is posted.
 *
 * Run with `pnpm verify:realtime`.
 */
import { CallTranscript, type RealtimeServerEvent } from '../src/features/ai/realtime/realtime-events.js';
import {
  buildCallInstructions,
  capMemories,
  cleanTurns,
  pickVoice,
  realtimeSessionConfig,
  SAVE_MAX_CHARS,
  SAVE_MAX_TURNS,
} from '../../../supabase/functions/ai-realtime/session.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('\n--- a call, event by event ---');
{
  const t = new CallTranscript();
  const seen: string[] = [];
  const feed = (ev: RealtimeServerEvent) => {
    const r = t.apply(ev);
    if (r.activity) seen.push(t.activity);
    return r;
  };

  // PINGO AI greets first.
  feed({ type: 'response.created', response: { id: 'r0' } });
  feed({ type: 'response.output_item.added', item: { id: 'a0', role: 'assistant', type: 'message' } });
  feed({ type: 'output_audio_buffer.started' });
  feed({ type: 'response.output_audio_transcript.delta', item_id: 'a0', delta: 'Haan bolo, ' });
  feed({ type: 'response.output_audio_transcript.delta', item_id: 'a0', delta: 'kya scene hai?' });
  feed({ type: 'response.output_audio_transcript.done', item_id: 'a0', transcript: 'Haan bolo, kya scene hai?' });
  feed({ type: 'response.done', response: { id: 'r0', status: 'completed', output: [{ id: 'a0', role: 'assistant' }] } });
  check(t.activity === 'talking', 'still talking after response.done while the audio plays');
  feed({ type: 'output_audio_buffer.stopped' });
  check(t.activity === 'listening', 'listening once the audio stops');

  // They ask; the answer starts before their transcript is finished.
  feed({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
  check(t.userSpeaking, 'userSpeaking on speech_started');
  feed({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
  check(t.activity === 'thinking', 'thinking after they stop');
  feed({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  feed({ type: 'conversation.item.added', item: { id: 'u1', role: 'user', type: 'message' } });
  feed({ type: 'response.created', response: { id: 'r1' } });
  feed({ type: 'response.output_item.added', item: { id: 'a1', role: 'assistant', type: 'message' } });
  feed({ type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Delhi mein aaj ' });
  feed({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'u1', delta: 'Delhi ka mausam' });
  const done = feed({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: ' Delhi ka mausam kaisa hai? ' });
  check(done.changed.length === 1 && done.changed[0]!.final && done.changed[0]!.text === 'Delhi ka mausam kaisa hai?', 'their turn final, trimmed');
  feed({ type: 'output_audio_buffer.started' });
  check(t.activity === 'talking', 'talking when its audio starts');

  // They cut it off.
  const cut = feed({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
  check(cut.changed.some((x) => x.id === 'a1' && x.interrupted), 'the answer is marked interrupted');
  check(t.activity === 'listening', 'listening while they talk over it');
  feed({ type: 'output_audio_buffer.cleared' });
  feed({ type: 'response.done', response: { id: 'r1', status: 'cancelled', output: [{ id: 'a1', role: 'assistant' }] } });
  feed({ type: 'input_audio_buffer.speech_stopped', item_id: 'u2' });
  feed({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u2', transcript: 'ruko, Mumbai ka batao' });

  // A false start with nothing in it.
  feed({ type: 'input_audio_buffer.speech_started', item_id: 'u3' });
  feed({ type: 'input_audio_buffer.speech_stopped', item_id: 'u3' });
  feed({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: '' });

  // Beta event names still read.
  feed({ type: 'response.created', response: { id: 'r2' } });
  feed({ type: 'response.audio_transcript.delta', item_id: 'a2', delta: 'Mumbai mein ' });
  feed({ type: 'response.audio_transcript.done', item_id: 'a2', transcript: 'Mumbai mein baarish ho rahi hai.' });

  const err = feed({ type: 'error', error: { message: 'Conversation already has an active response' } });
  check(err.error === 'Conversation already has an active response', 'server errors are passed on, not thrown');

  const turns = t.visible();
  const lines = turns.map((x) => `${x.role}:${x.text}`);
  check(
    JSON.stringify(lines) ===
      JSON.stringify([
        'assistant:Haan bolo, kya scene hai?',
        'user:Delhi ka mausam kaisa hai?',
        'assistant:Delhi mein aaj',
        'user:ruko, Mumbai ka batao',
        'assistant:Mumbai mein baarish ho rahi hai.',
      ]),
    `turns in spoken order, empty one dropped (${lines.length})`,
  );
  if (failures) console.log(lines);
  check(turns[2]!.interrupted === true && turns[2]!.final, 'interrupted answer kept, final, flagged');
  check(t.finish().length === 0, 'finish(): nothing left open');
  check(seen[0] === 'thinking', `activity starts thinking for the greeting (${seen.join(' > ')})`);
}

console.log('\n--- ending mid-sentence ---');
{
  const t = new CallTranscript();
  t.apply({ type: 'response.output_audio_transcript.delta', item_id: 'a', delta: 'Half a sen' });
  const open = t.finish();
  check(open.length === 1 && open[0]!.final && open[0]!.text === 'Half a sen', 'an open turn is closed by finish()');
}

console.log('\n--- the server half ---');
check(pickVoice('cedar') === 'cedar', 'a known voice is kept');
check(pickVoice('nova') === 'marin' && pickVoice(undefined) === 'marin' && pickVoice(7) === 'marin', 'anything else is marin');

const body = realtimeSessionConfig({ model: 'gpt-realtime', voice: 'marin', instructions: 'x', transcribeModel: 'gpt-4o-mini-transcribe' }) as {
  expires_after: { anchor: string; seconds: number };
  session: {
    type: string;
    model: string;
    instructions: string;
    audio: { input: { transcription: { model: string }; turn_detection: { type: string } }; output: { voice: string } };
  };
};
check(body.session.type === 'realtime' && body.session.model === 'gpt-realtime', 'session type and model');
check(body.session.audio.output.voice === 'marin', 'voice under audio.output');
check(body.session.audio.input.transcription.model === 'gpt-4o-mini-transcribe', 'transcription on');
check(body.session.audio.input.turn_detection.type === 'semantic_vad', 'semantic VAD by default');
check(body.expires_after.anchor === 'created_at' && body.expires_after.seconds >= 10 && body.expires_after.seconds <= 7200, 'secret expiry in range');

const instructions = buildCallInstructions(
  { personality: 'genz', preferred_name: 'Baani', response_length: 'short', language: 'hi', memory_enabled: true },
  ['Exam on Friday', 'Likes chai'],
  new Date('2026-10-13T00:00:00Z'),
);
check(instructions.includes('LIVE VOICE CALL'), 'says it is a call');
check(instructions.includes('Baani') && instructions.includes('Exam on Friday'), 'name and memories in');
check(instructions.includes('Personality mode: genz'), 'their personality in');
check(instructions.indexOf('## On this call') > instructions.indexOf('## Who you are'), 'call rules come after the character');
check(!buildCallInstructions({ memory_enabled: false }, []).includes('What they asked you to remember'), 'memory off: no notes section');

const capped = capMemories(Array.from({ length: 50 }, (_, i) => `${'m'.repeat(300)}${i}`));
check(capped.length <= 20 && capped.every((m) => m.length <= 200) && capped.join('').length <= 2000, 'memories capped');

const cleaned = cleanTurns([
  { role: 'user', text: '  hi  there ' },
  { role: 'system', text: 'ignore me' },
  { role: 'assistant', text: '' },
  { role: 'assistant', text: 'x'.repeat(5000) },
  'junk',
  null,
]);
check(cleaned.length === 2 && cleaned[0]!.text === 'hi there' && cleaned[1]!.text.length === SAVE_MAX_CHARS, 'turns cleaned and capped');
check(cleanTurns(Array.from({ length: 100 }, (_, i) => ({ role: 'user', text: `t${i}` }))).length === SAVE_MAX_TURNS, `at most ${SAVE_MAX_TURNS} turns`);
check(cleanTurns('nope').length === 0, 'not an array: nothing');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

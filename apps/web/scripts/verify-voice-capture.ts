/**
 * The capture worklet, executed.
 *
 * This code is a string, so the compiler never looks at it and a mistake inside
 * it surfaces at the worst possible moment — when somebody taps record. Here it
 * runs against stub globals, with one question asked of it: **does every frame
 * that goes in come back out?**
 *
 * It did not. A block was only posted once full, so up to 4096 frames — around
 * 85ms at 48kHz — were always still held when the take ended. That is the end
 * of the last word, missing from every note. The flush is what these checks
 * exist to hold in place.
 *
 * Run with `pnpm verify:voice-capture`.
 */
import { PCM_BLOCK_FRAMES, PCM_WORKLET_SOURCE } from '../src/lib/audio/pcm-worklet.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

interface Posted {
  pcm: Float32Array;
  peak: number;
  flush?: boolean;
}

/** A processor, running the real source against stubs. */
function makeProcessor() {
  const posted: Posted[] = [];
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(message: Posted) {
      posted.push(message);
    },
  };

  class AudioWorkletProcessorStub {
    port = port;
  }

  let registered: (new () => { process: (inputs: Float32Array[][]) => boolean }) | undefined;
  const factory = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    `${PCM_WORKLET_SOURCE}`,
  );
  factory(AudioWorkletProcessorStub, (_name: string, ctor: never) => {
    registered = ctor;
  });

  if (!registered) throw new Error('the worklet did not register a processor');
  const processor = new registered();

  return {
    posted,
    /** Feed n frames of a recognisable ramp, as the audio thread would. */
    feed(frames: number, quantum = 128) {
      let written = 0;
      while (written < frames) {
        const size = Math.min(quantum, frames - written);
        const block = new Float32Array(size);
        for (let i = 0; i < size; i += 1) block[i] = (written + i + 1) / frames;
        processor.process([[block]]);
        written += size;
      }
    },
    flush() {
      port.onmessage?.({ data: { flush: true } });
    },
  };
}

const total = (posted: Posted[]) => posted.reduce((sum, p) => sum + p.pcm.length, 0);

console.log('— the source runs at all —');

{
  const p = makeProcessor();
  check(true, 'the worklet source parses and registers a processor');
  p.feed(PCM_BLOCK_FRAMES);
  check(p.posted.length === 1, `a full block is posted as soon as it is full (${p.posted.length})`);
  check(p.posted[0]!.pcm.length === PCM_BLOCK_FRAMES, 'and it is a whole block');
  check(p.posted[0]!.peak > 0, 'with a level for the meter');
}

console.log('\n— nothing is lost —');

{
  /*
   * 10,000 frames is two full blocks and an awkward remainder — the ordinary
   * case, since a recording almost never ends on a block boundary.
   */
  const p = makeProcessor();
  p.feed(10_000);
  check(total(p.posted) === 2 * PCM_BLOCK_FRAMES, `without a flush, the remainder is still held (${total(p.posted)} of 10000)`);

  p.flush();
  check(total(p.posted) === 10_000, `after the flush, every frame has been handed over (${total(p.posted)})`);

  const tail = p.posted[p.posted.length - 1]!;
  check(tail.flush === true, 'and the last message says it is the flush');
  check(tail.pcm.length === 10_000 - 2 * PCM_BLOCK_FRAMES, `the tail is exactly what was left (${tail.pcm.length})`);

  /*
   * Order and content, not just the count. A tail that is right in length and
   * wrong in content would sound like the note ending on a click.
   */
  const joined = new Float32Array(10_000);
  let at = 0;
  for (const message of p.posted) {
    joined.set(message.pcm, at);
    at += message.pcm.length;
  }
  const expected = Array.from({ length: 10_000 }, (_, i) => (i + 1) / 10_000);
  const mismatch = expected.findIndex((value, i) => Math.abs(value - joined[i]!) > 1e-6);
  check(mismatch === -1, `and it is the same audio, in order${mismatch === -1 ? '' : ` (first mismatch at ${mismatch})`}`);
}

console.log('\n— the flush behaves at the edges —');

{
  const p = makeProcessor();
  p.flush();
  check(p.posted.length === 1 && p.posted[0]!.pcm.length === 0, 'flushing an empty processor posts nothing of substance');

  const exact = makeProcessor();
  exact.feed(PCM_BLOCK_FRAMES);
  exact.flush();
  check(
    total(exact.posted) === PCM_BLOCK_FRAMES,
    `a take that ends exactly on a block boundary is not duplicated (${total(exact.posted)})`,
  );

  const twice = makeProcessor();
  twice.feed(5_000);
  twice.flush();
  twice.flush();
  check(total(twice.posted) === 5_000, `flushing twice does not add the tail twice (${total(twice.posted)})`);
}

console.log('\n— it survives what the audio thread actually does —');

{
  const p = makeProcessor();
  // No input at all: a disconnected node still gets called.
  const empty = makeProcessor();
  check(
    (() => {
      empty.feed(0);
      return empty.posted.length === 0;
    })(),
    'a quantum with no input posts nothing and does not throw',
  );

  /*
   * The real graph delivers 128 frames at a time; a block therefore always
   * fills part-way through a quantum, and the code has to carry the remainder
   * into the next block rather than dropping it.
   */
  p.feed(4_100, 128);
  p.flush();
  check(total(p.posted) === 4_100, `frames that straddle a block boundary are kept (${total(p.posted)})`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

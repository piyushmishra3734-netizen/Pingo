/**
 * Reading a reply aloud, starting before the whole thing is ready.
 *
 * ## The feeling being built
 *
 * A reply synthesised in one request is silent for as long as the whole thing
 * takes, then speaks. Split into sentences it speaks after the first one, and
 * fetches the rest while that plays - so the wait is the length of a sentence
 * rather than the length of an answer, and it sounds like somebody starting to
 * talk rather than a file finishing downloading.
 *
 * The pipeline is one sentence ahead, never more. Fetching the whole reply in
 * parallel would arrive sooner and pay for audio nobody hears when they press
 * stop halfway, which on a metered endpoint is real money for silence.
 *
 * ## Falling back is the normal case, not the error case
 *
 * The server voice is English-only. PINGO answers in Devanagari often, and the
 * device may well have a Hindi voice even when the server has none - so a
 * refusal is not a failure, it is the other route. Both are tried per sentence,
 * because a single reply can and does switch script halfway.
 */

/**
 * A whole reply, in one request, unless it is genuinely long.
 *
 * ## What this is fixing
 *
 * Chunking per sentence was designed when synthesis was slow: split the reply,
 * speak the first part while fetching the rest, and the wait becomes the length
 * of a sentence instead of an answer.
 *
 * Then the provider changed. Sarvam returns a full reply in one and a half to
 * two and a half seconds and accepts 2500 characters, so splitting a 200
 * character reply into four buys perhaps a second and costs four requests. It
 * showed up exactly as you would expect: about ten reads produced 57 requests
 * on the dashboard.
 *
 * So the budget is now the provider's, not a sentence's. Almost every reply is
 * one request. Only something genuinely long is split, and then into halves
 * rather than sentences.
 *
 * The pipeline underneath is unchanged and still earns its keep on those - the
 * second half is fetched while the first plays.
 */
const MAX_CHUNK = 900;

/**
 * Break a reply into the pieces that get spoken one at a time.
 *
 * Sentence ends first, because that is where a person pauses anyway and a seam
 * there is inaudible. A sentence longer than the budget is broken at a comma,
 * and failing that at a space - never mid-word, which is the one seam everybody
 * hears.
 *
 * Exported for `verify:speak-chunks`: it is the piece of this with a right
 * answer, and the rest is timing and audio elements.
 */
export function chunkForSpeech(text: string, max = MAX_CHUNK): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  /*
   * Under the budget is one request, whatever its punctuation.
   *
   * This is the line that matters: it is the difference between "haan bhai.
   * sab badhiya. tum sunao." costing three requests and costing one, and that
   * shape is most of what PINGO says.
   */
  if (clean.length <= max) return [clean];

  const sentences = clean.match(/[^.!?।]+[.!?।]+\s*|[^.!?।]+$/g) ?? [clean];
  const out: string[] = [];

  for (const raw of sentences) {
    let piece = raw.trim();
    if (!piece) continue;

    /*
     * A short sentence joins the one before it rather than becoming its own
     * request. "Haan." and "Bilkul." are each a network round trip otherwise,
     * and the pause between them is longer than the words.
     */
    const previous = out[out.length - 1];
    if (previous && previous.length + piece.length + 1 <= max) {
      out[out.length - 1] = `${previous} ${piece}`;
      continue;
    }

    while (piece.length > max) {
      // A comma is the next best pause after a full stop; a space is the last
      // resort that is still not inside a word.
      const window = piece.slice(0, max);
      const at = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' '));
      const cut = at > max * 0.4 ? at : max;
      out.push(piece.slice(0, cut).trim());
      piece = piece.slice(cut).trim();
    }

    if (piece) out.push(piece);
  }

  return out.filter(Boolean);
}

/**
 * How loud the voice is right now, 0-1.
 *
 * Read every frame by whatever is drawing, rather than pushed, because the
 * thing that wants it is a render loop and a callback per sample would be a
 * state update per sample.
 *
 * The point is that the mark on screen moves with the actual voice - louder on
 * a stressed syllable, still in a pause - and not on a timer pretending to. A
 * timer is what everything looked like before, and it reads as decoration
 * because it is.
 */
export type Amplitude = () => number;

/** Handle on a reading in progress. */
export interface Speech {
  /** Stops immediately, wherever it is. */
  stop: () => void;
  /** Resolves when the last sentence has finished, or when stopped. */
  done: Promise<void>;
  /** How loud it is, right now. Zero when nothing is playing. */
  level: Amplitude;
  /**
   * Resolves the moment the first sound starts.
   *
   * The gap before it is not always short: Workers AI cold-starts the voice
   * after an idle spell and the first sentence measured at ten seconds against
   * one and a half warm. Ten seconds of nothing after pressing a button reads
   * as broken, so the caller needs to know when the silence ends in order to
   * say something during it.
   */
  started: Promise<void>;
}

/** Where the audio for one sentence comes from. */
type Fetcher = (text: string) => Promise<Blob | undefined>;

/** The device's own voices, for anything the server will not read. */
function speakLocally(text: string, onEnd: () => void): (() => void) | undefined {
  const synth = window.speechSynthesis;
  if (!synth) return undefined;

  const utterance = new SpeechSynthesisUtterance(text);
  // Same rule as everywhere else: say which language or an English voice reads
  // Devanagari as silence.
  const devanagari = /[ऀ-ॿ]/.test(text);
  utterance.lang = devanagari ? 'hi-IN' : 'en-IN';
  const voices = synth.getVoices();
  const match =
    voices.find((v) => v.lang.replace('_', '-').toLowerCase() === utterance.lang.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(devanagari ? 'hi' : 'en-in'));
  if (match) utterance.voice = match;

  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  synth.speak(utterance);

  /*
   * Nothing started, so do not wait for it to end. `speak()` on text no
   * installed voice can read returns without speaking and without an error.
   */
  window.setTimeout(() => {
    if (!synth.speaking && !synth.pending) onEnd();
  }, 700);

  return () => synth.cancel();
}

/**
 * Read `text` aloud, server voice first and the device's second.
 *
 * `fetchAudio` returns undefined for a sentence the server will not speak,
 * which is a routing decision rather than a failure - see the note at the top.
 */
export function speakStreaming(text: string, fetchAudio: Fetcher): Speech {
  const chunks = chunkForSpeech(text);
  let stopped = false;
  let current: HTMLAudioElement | undefined;
  let cancelLocal: (() => void) | undefined;
  /*
   * Assigned synchronously by the Promise constructor, which the compiler
   * cannot see. A no-op default keeps it honest without an assertion.
   */
  /*
   * One context and one analyser for the whole reading.
   *
   * Created lazily because an `AudioContext` made before a user gesture starts
   * suspended, and reused across sentences because building one per sentence
   * would click audibly at every seam.
   */
  let context: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let bins: Uint8Array<ArrayBuffer> | undefined;

  const level: Amplitude = () => {
    if (!analyser || !bins) return 0;
    analyser.getByteTimeDomainData(bins);
    /*
     * Peak deviation from silence rather than an average. An average over a
     * whole frame flattens speech into a nearly constant number - the mark
     * would hum rather than move with the words.
     */
    let peak = 0;
    for (let i = 0; i < bins.length; i += 1) {
      const away = Math.abs(bins[i]! - 128);
      if (away > peak) peak = away;
    }
    return Math.min(1, peak / 90);
  };

  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let begin: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });

  const stop = () => {
    stopped = true;
    current?.pause();
    current = undefined;
    cancelLocal?.();
    cancelLocal = undefined;
    analyser = undefined;
    void context?.close().catch(() => undefined);
    context = undefined;
    // Stopping before anything played still ends the waiting state; nobody is
    // left watching a button that says it is preparing something cancelled.
    begin();
    finish();
  };

  void (async () => {
    /*
     * One ahead. The next sentence is requested the moment the current one
     * starts playing, so its download overlaps the speaking rather than
     * following it - which is the whole trick.
     */
    let ahead: Promise<Blob | undefined> | undefined = chunks[0]
      ? fetchAudio(chunks[0])
      : undefined;

    for (let i = 0; i < chunks.length && !stopped; i += 1) {
      const audio = await ahead;
      ahead = chunks[i + 1] ? fetchAudio(chunks[i + 1]!) : undefined;
      if (stopped) break;

      // The first chunk is the only one anybody waits through - every later one
      // was fetched while its predecessor played.
      begin();

      await new Promise<void>((next) => {
        if (!audio) {
          cancelLocal = speakLocally(chunks[i]!, next);
          if (!cancelLocal) next();
          return;
        }

        const url = URL.createObjectURL(audio);
        const element = new Audio(url);
        current = element;

        /*
         * Tapped for its amplitude on the way to the speakers.
         *
         * `createMediaElementSource` re-routes the element, so it must also be
         * connected to the destination or the audio plays silently - a mistake
         * that presents as "the animation works but there is no sound".
         */
        try {
          context ??= new AudioContext();
          if (context.state === 'suspended') void context.resume();
          analyser ??= (() => {
            const node = context.createAnalyser();
            node.fftSize = 256;
            // Backed by a plain `ArrayBuffer`: `getByteTimeDomainData` will not accept
            // one that might be shared.
            bins = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
            node.connect(context.destination);
            return node;
          })();
          context.createMediaElementSource(element).connect(analyser);
        } catch {
          // No Web Audio, or an element that cannot be tapped. The sound still
          // plays; only the animation loses its input.
        }
        const release = () => {
          URL.revokeObjectURL(url);
          next();
        };
        element.onended = release;
        // A file that will not play is not worth stalling the rest of the
        // reply for; move on to the next sentence.
        element.onerror = release;
        void element.play().catch(release);
      });
    }

    if (!stopped) finish();
  })();

  return { stop, done, started, level };
}

/** A reading that is still being written. */
export interface SpeechQueue {
  /** Add a finished sentence. Speaking starts on the first one. */
  push: (sentence: string) => void;
  /** No more sentences are coming. */
  end: () => void;
  /** True once anything has been queued, so a caller can tell it was used. */
  readonly started: boolean;
  /** The usual handle - stop, done, level. */
  speech: Speech;
}

/**
 * Speak sentences as they arrive, before the answer is finished.
 *
 * `speakStreaming` needs the whole reply up front, which is fine for a button
 * that reads a message already on screen. A call cannot afford it: the model
 * takes two to six seconds and the voice another one and a half, and run end to
 * end that is most of a conversation spent in silence.
 *
 * Here the model streams, and each finished sentence is pushed in as it exists.
 * The first one starts the voice while the rest is still being written, so the
 * two costs overlap rather than add - which is what published voice-agent
 * guidance means by budgeting to *first* token and *first* audio chunk rather
 * than to the whole reply.
 *
 * One request per sentence here, deliberately, where the Read aloud path
 * batches. The batching was to stop a four-sentence reply costing four charges;
 * on a call the first sentence has to leave immediately and there is nothing to
 * batch it with yet.
 */
export function openSpeech(fetchAudio: Fetcher): SpeechQueue {
  const pending: string[] = [];
  let closed = false;
  let stopped = false;
  let queued = 0;

  let current: HTMLAudioElement | undefined;
  let context: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let bins: Uint8Array<ArrayBuffer> | undefined;

  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  /** Wakes the pump when a sentence lands while it is waiting. */
  let wake: () => void = () => {};

  const level: Amplitude = () => {
    if (!analyser || !bins) return 0;
    analyser.getByteTimeDomainData(bins);
    let peak = 0;
    for (let i = 0; i < bins.length; i += 1) {
      const away = Math.abs(bins[i]! - 128);
      if (away > peak) peak = away;
    }
    return Math.min(1, peak / 90);
  };

  const stop = () => {
    stopped = true;
    closed = true;
    pending.length = 0;
    current?.pause();
    current = undefined;
    analyser = undefined;
    void context?.close().catch(() => undefined);
    context = undefined;
    wake();
    finish();
  };

  const play = async (audio: Blob) =>
    new Promise<void>((next) => {
      const url = URL.createObjectURL(audio);
      const element = new Audio(url);
      current = element;

      try {
        context ??= new AudioContext();
        if (context.state === 'suspended') void context.resume();
        analyser ??= (() => {
          const node = context.createAnalyser();
          node.fftSize = 256;
          bins = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
          node.connect(context.destination);
          return node;
        })();
        context.createMediaElementSource(element).connect(analyser);
      } catch {
        // No Web Audio, or an element that cannot be tapped. The sound still
        // plays; only the meter loses its input.
      }

      const release = () => {
        URL.revokeObjectURL(url);
        next();
      };
      element.onended = release;
      element.onerror = release;
      void element.play().catch(release);
    });

  /*
   * One sentence at a time, in order, fetching the next while the current one
   * plays. Order matters more than throughput here - audio that arrives out of
   * sequence is worse than audio that arrives a moment later.
   */
  void (async () => {
    let ahead: Promise<Blob | undefined> | undefined;

    for (;;) {
      if (stopped) break;

      if (!ahead) {
        const next = pending.shift();
        if (next === undefined) {
          if (closed) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        ahead = fetchAudio(next);
      }

      const audio = await ahead;
      ahead = pending.length > 0 ? fetchAudio(pending.shift()!) : undefined;
      if (stopped) break;
      if (audio) await play(audio);
    }

    if (!stopped) finish();
  })();

  return {
    push: (sentence: string) => {
      const words = sentence.trim();
      if (!words || closed) return;
      queued += 1;
      pending.push(words);
      wake();
    },
    end: () => {
      closed = true;
      wake();
    },
    get started() {
      return queued > 0;
    },
    speech: { stop, done, level, started: done },
  };
}

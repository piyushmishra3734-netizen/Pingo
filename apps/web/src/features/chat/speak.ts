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

/** Long enough to sound like a sentence, short enough to arrive quickly. */
const MAX_CHUNK = 220;

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

/** Handle on a reading in progress. */
export interface Speech {
  /** Stops immediately, wherever it is. */
  stop: () => void;
  /** Resolves when the last sentence has finished, or when stopped. */
  done: Promise<void>;
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

  return { stop, done, started };
}

/**
 * A PINGO AI voice call's transcript and turn-taking, read from OpenAI
 * Realtime server events.
 *
 * Pure: it takes the events that arrive on the `oai-events` data channel and
 * keeps the turns and who is talking. No WebRTC, no DOM, so
 * `pnpm verify:realtime` can feed it a recorded sequence and check the result.
 *
 * ## Order
 *
 * A turn's place is set when the turn is first heard of, not when its text is
 * finished. Their words are transcribed after they stop speaking, often while
 * PINGO AI has already started answering; ordering by "finished" would put the
 * answer above the question. So a user turn is placed at
 * `input_audio_buffer.speech_started` (or `committed`, or the item being
 * added), an assistant turn at `response.output_item.added` (or its first
 * transcript piece), and the text fills in later.
 *
 * ## Event names
 *
 * GA names (2026): `response.output_audio_transcript.*`. The older beta names
 * (`response.audio_transcript.*`) are read too, so a model or proxy still on
 * them works.
 */

export type CallRole = 'user' | 'assistant';

export interface CallTurn {
  /** The Realtime item id: stable for the turn's life. */
  id: string;
  role: CallRole;
  text: string;
  /** No more text is coming for this turn. */
  final: boolean;
  /** PINGO AI was cut off mid-answer; `text` may include words it never said aloud. */
  interrupted?: boolean;
}

/**
 * What PINGO AI is doing:
 * - `listening`: waiting, or hearing them (see `userSpeaking`).
 * - `thinking`: they stopped; the answer is being made.
 * - `talking`: its voice is playing.
 */
export type CallActivity = 'listening' | 'thinking' | 'talking';

/** A server event, loosely: only the fields read here. */
export interface RealtimeServerEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  item?: { id?: string; role?: string; type?: string };
  response?: {
    id?: string;
    status?: string;
    output?: { id?: string; role?: string }[];
    status_details?: { error?: { message?: string } } | null;
  };
  error?: { message?: string; code?: string; type?: string };
}

export interface Applied {
  /** Turns whose text or state changed, in transcript order. */
  changed: CallTurn[];
  /** True when `activity` or `userSpeaking` changed. */
  activity: boolean;
  /** A problem the server reported. Most are not fatal; the call goes on. */
  error?: string;
}

export class CallTranscript {
  readonly turns: CallTurn[] = [];
  activity: CallActivity = 'listening';
  /** Their voice is being heard right now (server VAD). */
  userSpeaking = false;
  #byId = new Map<string, CallTurn>();
  #audioPlaying = false;
  #responding = false;
  #currentAssistant: string | null = null;

  /** Turns with something said, for showing and for saving. */
  visible(): CallTurn[] {
    return this.turns.filter((t) => t.text.trim());
  }

  apply(ev: RealtimeServerEvent): Applied {
    const changed = new Set<CallTurn>();
    const before = `${this.activity}|${this.userSpeaking}`;
    let error: string | undefined;

    switch (ev.type) {
      case 'input_audio_buffer.speech_started': {
        this.userSpeaking = true;
        if (ev.item_id) this.#ensure(ev.item_id, 'user');
        // Talking over PINGO AI: its answer is being cut off.
        if (this.#audioPlaying || this.#responding) this.#interrupt(changed);
        this.activity = 'listening';
        break;
      }
      case 'input_audio_buffer.speech_stopped': {
        this.userSpeaking = false;
        if (ev.item_id) this.#ensure(ev.item_id, 'user');
        this.activity = 'thinking';
        break;
      }
      case 'input_audio_buffer.committed': {
        if (ev.item_id) this.#ensure(ev.item_id, 'user');
        break;
      }
      case 'conversation.item.added':
      case 'conversation.item.created': {
        const it = ev.item;
        if (it?.id && (it.type === undefined || it.type === 'message') && (it.role === 'user' || it.role === 'assistant')) {
          this.#ensure(it.id, it.role);
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.delta': {
        if (!ev.item_id || !ev.delta) break;
        const t = this.#ensure(ev.item_id, 'user');
        if (!t.final) {
          t.text += ev.delta;
          changed.add(t);
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        if (!ev.item_id) break;
        const t = this.#ensure(ev.item_id, 'user');
        t.text = (ev.transcript ?? t.text).trim();
        t.final = true;
        changed.add(t);
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        if (!ev.item_id) break;
        const t = this.#ensure(ev.item_id, 'user');
        t.final = true;
        changed.add(t);
        break;
      }
      case 'response.created': {
        this.#responding = true;
        if (this.activity !== 'talking' && !this.userSpeaking) this.activity = 'thinking';
        break;
      }
      case 'response.output_item.added': {
        const it = ev.item;
        if (it?.id && it.role === 'assistant') {
          this.#ensure(it.id, 'assistant');
          this.#currentAssistant = it.id;
        }
        break;
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        if (!ev.item_id || !ev.delta) break;
        const t = this.#ensure(ev.item_id, 'assistant');
        this.#currentAssistant = ev.item_id;
        if (!t.final) {
          t.text += ev.delta;
          changed.add(t);
        }
        // The words lead the sound by a moment; `output_audio_buffer.started` confirms it.
        if (!this.userSpeaking) this.activity = 'talking';
        break;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        if (!ev.item_id) break;
        const t = this.#ensure(ev.item_id, 'assistant');
        if (typeof ev.transcript === 'string' && !t.interrupted) t.text = ev.transcript.trim();
        t.final = true;
        changed.add(t);
        break;
      }
      case 'output_audio_buffer.started': {
        this.#audioPlaying = true;
        if (!this.userSpeaking) this.activity = 'talking';
        break;
      }
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared': {
        this.#audioPlaying = false;
        this.activity = this.userSpeaking ? 'listening' : this.#responding ? 'thinking' : 'listening';
        break;
      }
      case 'response.done': {
        this.#responding = false;
        const r = ev.response;
        const cancelled = r?.status === 'cancelled';
        for (const out of r?.output ?? []) {
          const t = out.id ? this.#byId.get(out.id) : undefined;
          if (!t || t.role !== 'assistant') continue;
          if (cancelled && !t.interrupted) t.interrupted = true;
          if (!t.final || cancelled) {
            t.final = true;
            t.text = t.text.trim();
            changed.add(t);
          }
        }
        if (r?.status === 'failed') error = r.status_details?.error?.message || 'The answer failed.';
        // Over WebRTC the sound may still be playing; `output_audio_buffer.stopped` ends `talking` then.
        if (!this.#audioPlaying) this.activity = 'listening';
        break;
      }
      case 'error': {
        error = ev.error?.message || 'The voice service reported an error.';
        break;
      }
      default:
        break;
    }

    const order = new Map(this.turns.map((t, i) => [t, i]));
    return {
      changed: [...changed].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
      activity: before !== `${this.activity}|${this.userSpeaking}`,
      ...(error ? { error } : {}),
    };
  }

  /** Everything still open is done: the call ended. */
  finish(): CallTurn[] {
    const changed: CallTurn[] = [];
    for (const t of this.turns) {
      if (!t.final) {
        t.final = true;
        t.text = t.text.trim();
        changed.push(t);
      }
    }
    return changed;
  }

  #ensure(id: string, role: CallRole): CallTurn {
    let t = this.#byId.get(id);
    if (!t) {
      t = { id, role, text: '', final: false };
      this.#byId.set(id, t);
      this.turns.push(t);
    }
    return t;
  }

  #interrupt(changed: Set<CallTurn>): void {
    const t = this.#currentAssistant ? this.#byId.get(this.#currentAssistant) : undefined;
    if (t && !t.interrupted && (!t.final || this.#audioPlaying)) {
      t.interrupted = true;
      changed.add(t);
    }
  }
}

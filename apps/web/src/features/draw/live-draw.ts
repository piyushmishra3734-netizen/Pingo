import type { LiveDrawLink, LiveDrawPacket } from '@pingo/core';

import { MAX_SIZE, normalizeStroke, type Brush, type DrawStroke } from './brushes.js';

/**
 * Live drawing: the strokes, as they are drawn, to whoever has the thread open.
 *
 * Built for a bad connection. A packet is a few dozen bytes (integer points,
 * thinned), only one is ever in flight, and while it is in flight new points
 * pile into the next one - so a slow network sends fewer, bigger packets
 * instead of a queue that falls further behind. Nothing here has to arrive:
 * a lost packet is a small gap in a preview, and the picture sent on Done is
 * what stays in the chat.
 */

const GRID = 1000;
/** The fastest a packet may follow another, and the slowest it is stretched to on a slow link. */
const MIN_GAP_MS = 100;
const MAX_GAP_MS = 1500;
/** Someone who has said nothing for this long is no longer drawing. */
export const DRAWER_TIMEOUT_MS = 8000;
const BEAT_MS = 2500;
const MAX_POINTS_PER_PACKET = 120;
/** A pad streams for at most this long; past it only the final picture is sent. */
const LIVE_MAX_MS = 60_000;
/** After opening, how long strokes wait for somebody to say they are watching. */
const WATCH_GRACE_MS = 2500;
const BRUSHES: readonly Brush[] = ['pen', 'marker', 'neon', 'chalk', 'arrow', 'eraser'];

// ----------------------------------------------------------------- sending

export class LiveDrawSender {
  readonly openedAt = Date.now();
  readonly #link: LiveDrawLink;
  #queue: LiveDrawPacket[] = [];
  #stroke = 0;
  #inFlight = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #beat: ReturnType<typeof setInterval> | undefined;
  #rtt = 0;
  #lastSentAt = 0;
  #last: [number, number] | undefined;
  #lastSeen: [number, number] | undefined;
  #closed = false;
  #watchers = new Set<string>();

  constructor(link: LiveDrawLink) {
    this.#link = link;
    this.#push({ u: link.me, op: 'open', t: this.openedAt });
    this.#beat = setInterval(() => {
      if (this.#queue.length === 0 && !this.#inFlight) this.#push({ u: link.me, op: 'beat' });
    }, BEAT_MS);
  }

  /** A stroke starts here. */
  begin(brush: Brush, colour: string, size: number, x: number, y: number): void {
    this.#stroke += 1;
    this.#last = undefined;
    this.#lastSeen = undefined;
    const point = this.#quantize(x, y);
    this.#push({ u: this.#link.me, s: this.#stroke, h: [brush, colour, Math.round(size * 10000) / 10000], p: point });
    this.#last = [point[0]!, point[1]!];
  }

  point(x: number, y: number): void {
    const [qx, qy] = this.#quantize(x, y) as [number, number];
    this.#lastSeen = [qx, qy];
    // A slow link gets fewer points: the line is the same shape, with longer straight pieces.
    const threshold = this.#rtt > 700 ? 7 : this.#rtt > 300 ? 4 : 2;
    const last = this.#last;
    if (last && Math.abs(qx - last[0]) < threshold && Math.abs(qy - last[1]) < threshold) return;
    this.#last = [qx, qy];
    this.#append([qx, qy]);
  }

  end(): void {
    // The point the thinning dropped last is where the line really ended.
    if (this.#lastSeen && (this.#lastSeen[0] !== this.#last?.[0] || this.#lastSeen[1] !== this.#last?.[1])) {
      this.#append([...this.#lastSeen]);
    }
    const tail = this.#queue[this.#queue.length - 1];
    if (tail && tail.s === this.#stroke && !tail.op && !tail.e) tail.e = 1;
    else this.#push({ u: this.#link.me, s: this.#stroke, e: 1 });
    this.#last = undefined;
    this.#lastSeen = undefined;
    this.#schedule();
  }

  /** Redo: the whole stroke again, as a new one. */
  redo(stroke: DrawStroke): void {
    this.#stroke += 1;
    const pts: number[] = [];
    for (const p of stroke.points) pts.push(...this.#quantize(p.x, p.y));
    for (let i = 0; i < pts.length || i === 0; i += MAX_POINTS_PER_PACKET * 2) {
      const chunk = pts.slice(i, i + MAX_POINTS_PER_PACKET * 2);
      this.#queue.push({
        u: this.#link.me,
        s: this.#stroke,
        ...(i === 0 ? { h: [stroke.brush, stroke.colour, Math.round(stroke.size * 10000) / 10000] as [string, string, number] } : {}),
        p: chunk,
        ...(i + MAX_POINTS_PER_PACKET * 2 >= pts.length ? { e: 1 as const } : {}),
      });
    }
    this.#schedule();
  }

  undo(): void {
    this.#push({ u: this.#link.me, op: 'undo' });
  }

  /** The pad is closed. Sent at once, ahead of anything still waiting. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#beat);
    clearTimeout(this.#timer);
    // What was still queued is of no use to a preview that is being closed.
    this.#queue = [];
    void this.#link.send({ u: this.#link.me, op: 'close' });
  }

  #quantize(x: number, y: number): number[] {
    const q = (v: number) => Math.min(GRID, Math.max(0, Math.round(v * GRID)));
    return [q(x), q(y)];
  }

  #append(pair: number[]): void {
    const tail = this.#queue[this.#queue.length - 1];
    if (tail && tail.s === this.#stroke && !tail.op && !tail.e && tail.p && tail.p.length < MAX_POINTS_PER_PACKET * 2) {
      tail.p.push(...pair);
    } else {
      this.#queue.push({ u: this.#link.me, s: this.#stroke, p: [...pair] });
    }
    this.#schedule();
  }

  #push(packet: LiveDrawPacket): void {
    this.#queue.push(packet);
    this.#schedule();
  }

  #schedule(): void {
    if (this.#closed || this.#inFlight || this.#timer || this.#queue.length === 0) return;
    const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, this.#rtt * 0.8));
    const wait = Math.max(0, this.#lastSentAt + gap - Date.now());
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#flush();
    }, wait);
  }

  /** Somebody who has the thread on screen has said so. */
  watch(userId: string, on: boolean): void {
    if (on) this.#watchers.add(userId);
    else this.#watchers.delete(userId);
    if (on) this.#schedule();
  }

  #flush(): void {
    const first = this.#queue[0];
    if (!first || this.#closed) return;
    const now = Date.now();
    // Opening is always announced; everything else is only worth sending to somebody who is looking.
    if (first.op !== 'open' && this.#watchers.size === 0) {
      if (now - this.openedAt < WATCH_GRACE_MS) {
        // Watchers answer the open within a moment; the first strokes wait for them.
        this.#timer = setTimeout(() => {
          this.#timer = undefined;
          this.#flush();
        }, 300);
        return;
      }
      this.#queue.shift();
      this.#schedule();
      return;
    }
    if (first.op !== 'open' && now - this.openedAt > LIVE_MAX_MS) {
      // A long-open pad stops streaming; the picture sent on Done is unaffected.
      this.#queue.shift();
      this.#schedule();
      return;
    }
    const packet = this.#queue.shift()!;
    this.#inFlight = true;
    const started = Date.now();
    this.#lastSentAt = started;
    void this.#link.send(packet).then(() => {
      this.#inFlight = false;
      // Smoothed round trip, which sets how thin and how slow the next packets are.
      const took = Date.now() - started;
      this.#rtt = this.#rtt === 0 ? took : this.#rtt * 0.6 + took * 0.4;
      this.#schedule();
    });
  }
}

// --------------------------------------------------------------- receiving

/**
 * What the other side has drawn so far. Input comes off the network, so every
 * field is checked and clamped before it is trusted.
 */
export class LiveDrawState {
  drawer: string | undefined;
  strokes: DrawStroke[] = [];
  lastAt = 0;
  /** When the drawer closed their pad; the preview stays up until the picture arrives. */
  closedAt = 0;
  #byId = new Map<number, DrawStroke>();
  #points = 0;

  /** Somebody (other than us) is drawing right now. */
  busy(now = Date.now()): string | undefined {
    return this.drawer && !this.closedAt && now - this.lastAt < DRAWER_TIMEOUT_MS ? this.drawer : undefined;
  }

  /** Returns true when there is something new to paint. */
  apply(packet: LiveDrawPacket, now = Date.now()): boolean {
    if (typeof packet.u !== 'string') return false;
    // Watching is about the sender's side only; it says nothing about who is drawing.
    if (packet.op === 'watch' || packet.op === 'unwatch') return false;
    // One drawer at a time: a second person's packets are ignored until the first is done.
    const current = this.busy(now);
    if (current && current !== packet.u) return false;

    if (packet.op === 'open') {
      this.#reset();
      this.drawer = packet.u;
      this.lastAt = now;
      return true;
    }
    if (packet.op === 'close') {
      if (this.drawer !== packet.u) return false;
      this.closedAt = now;
      return true;
    }
    if (this.drawer !== packet.u || this.closedAt) {
      // Joined late, or the open was lost: take the drawer as they come.
      this.#reset();
      this.drawer = packet.u;
    }
    this.lastAt = now;

    if (packet.op === 'undo') {
      const last = this.strokes.pop();
      if (last) for (const [id, s] of this.#byId) if (s === last) this.#byId.delete(id);
      return true;
    }
    if (packet.op === 'beat') return false;

    if (typeof packet.s !== 'number') return false;
    let stroke = this.#byId.get(packet.s);
    if (!stroke && packet.h) {
      const [brush, colour, size] = packet.h;
      stroke = normalizeStroke({
        brush: BRUSHES.includes(brush as Brush) ? (brush as Brush) : 'pen',
        colour: typeof colour === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(colour) ? colour : '#ff3b5c',
        size: typeof size === 'number' && size > 0 ? Math.min(size, MAX_SIZE * 1.5) : undefined,
        points: [],
      });
      this.#byId.set(packet.s, stroke);
      this.strokes.push(stroke);
    }
    // A lost header means the stroke cannot be styled: skip it rather than guess.
    if (!stroke || !Array.isArray(packet.p)) return Boolean(stroke);
    for (let i = 0; i + 1 < packet.p.length && this.#points < 20000; i += 2) {
      const x = Number(packet.p[i]);
      const y = Number(packet.p[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      stroke.points.push({ x: Math.min(1, Math.max(0, x / GRID)), y: Math.min(1, Math.max(0, y / GRID)) });
      this.#points += 1;
    }
    return true;
  }

  clear(): void {
    this.#reset();
    this.drawer = undefined;
    this.closedAt = 0;
  }

  #reset(): void {
    this.strokes = [];
    this.#byId.clear();
    this.#points = 0;
    this.closedAt = 0;
  }
}

/** How far the list has to be pulled, after the finger's travel is halved, before letting go opens Locked chats. */
export const OPEN_AT = 72;
/** The most it follows the finger. */
export const MOST = 120;

export interface PullStep {
  /** How far to open the gap, in px. 0 when this is not a pull. */
  pull: number;
  /** True while the pull is ours, so the page's own overscroll must be held off. */
  consume: boolean;
  /** True the moment the pull first reaches "enough", once per pull. */
  justArmed: boolean;
}

/**
 * The pull-down gesture, with no screen in it, so it can be asserted.
 *
 * It starts only from the very top of the list and only for a drag that is
 * mostly vertical, so it never competes with scrolling or the stories row. It
 * follows the finger at half speed up to `MOST`, and letting go opens only when
 * the pull has reached `OPEN_AT`.
 */
export class PullGesture {
  #x = 0;
  #y = 0;
  #active = false;
  #last = 0;
  #armed = false;

  start(touches: number, x: number, y: number, scrollTop: number): void {
    if (touches !== 1 || scrollTop > 0) {
      this.#active = false;
      return;
    }
    this.#x = x;
    this.#y = y;
    this.#active = true;
    this.#last = 0;
    this.#armed = false;
  }

  move(x: number, y: number, scrollTop: number): PullStep {
    const idle: PullStep = { pull: 0, consume: false, justArmed: false };
    if (!this.#active) return idle;
    const down = y - this.#y;
    const across = x - this.#x;
    if (scrollTop > 0 || down <= 0 || Math.abs(across) > Math.abs(down)) {
      if (this.#last) this.reset();
      return idle;
    }
    const pull = Math.min(MOST, down * 0.5);
    this.#last = pull;
    const armed = pull >= OPEN_AT;
    const justArmed = armed && !this.#armed;
    this.#armed = armed;
    return { pull, consume: true, justArmed };
  }

  /** Whether letting go here opens Locked chats. Resets either way. */
  end(): boolean {
    const open = this.#active && this.#last >= OPEN_AT;
    this.reset();
    return open;
  }

  reset(): void {
    this.#active = false;
    this.#last = 0;
    this.#armed = false;
  }
}

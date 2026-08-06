/**
 * What is waiting to be shared, between arriving and being sent.
 *
 * ## Why a module holds it rather than router state
 *
 * A share can arrive from three places - the Android share sheet, a long press
 * inside PINGO, a link somebody copied - and two of those happen before any
 * screen has mounted. Router state only exists once a navigation happens, so
 * anything that arrives earlier would have nowhere to sit and would be lost.
 *
 * It is deliberately not persisted. A share somebody abandoned should not still
 * be waiting for them tomorrow, offering to send a photo they have forgotten
 * about to a person they no longer meant to send it to.
 */

export interface SharePayload {
  /** A link, a quote, or the caption typed alongside a picture. */
  text?: string;
  /** Pictures, already read into memory. */
  files?: File[];
  /** Where it came from, so the screen can say "Share post" rather than "Share". */
  label?: string;
}

let pending: SharePayload | undefined;

/** Listeners, so a screen already open notices a second share arriving. */
const watchers = new Set<(payload: SharePayload | undefined) => void>();

export function putShare(payload: SharePayload): void {
  /*
   * Merged, not replaced.
   *
   * Android sends an image and its caption as two separate deliveries for the
   * same share, and the second arriving as a fresh payload would throw the
   * first away - so a shared photo would lose its text, or the other way round.
   */
  pending = {
    text: payload.text ?? pending?.text,
    files: [...(pending?.files ?? []), ...(payload.files ?? [])],
    label: payload.label ?? pending?.label,
  };

  for (const watcher of watchers) watcher(pending);
}

export function takeShare(): SharePayload | undefined {
  const held = pending;
  pending = undefined;
  for (const watcher of watchers) watcher(undefined);
  return held;
}

export function peekShare(): SharePayload | undefined {
  return pending;
}

export function watchShare(listener: (payload: SharePayload | undefined) => void): () => void {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}

/**
 * A line the music sheet shows as its toast, from anywhere in the music code
 * ("Could not play X, skipping"). No UI here: the sheet subscribes.
 */
const notices = new Set<(text: string) => void>();

export function onMusicNotice(fn: (text: string) => void) {
  notices.add(fn);
  return () => {
    notices.delete(fn);
  };
}

export const musicNotice = (text: string) => notices.forEach((fn) => fn(text));

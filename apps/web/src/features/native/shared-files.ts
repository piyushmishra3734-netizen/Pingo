/**
 * Files another app shared into PINGO.
 *
 * The native side does not hand these over - it describes them and says where
 * to fetch them. See `SharedFiles.java`: a shared video is tens or hundreds of
 * megabytes, and the base64 route that suits a keyboard sticker would inflate
 * that by a third before a byte reached JavaScript. Fetching gives a Blob that
 * was streamed, plus the two things base64 loses: the file's real name and its
 * real type.
 *
 * ## Why the name matters
 *
 * A photo can be called anything. A document cannot: `Q3-report.pdf` arriving
 * as `shared-1754500000.bin` is a document nobody can identify afterwards, in a
 * chat that will still be there in a year.
 */

export interface SharedFile {
  id: string;
  name: string;
  type: string;
  /** -1 where the provider would not say. */
  size: number;
  /** Path on this origin, answered by the app's own request interception. */
  url: string;
}

declare global {
  interface Window {
    __pingoSharedFiles?: (files: SharedFile[]) => void;
  }
}

/*
 * A stack, for the same reason as keyboard images and shared text: more than
 * one thing listens over the life of the app, and a single global would let
 * whichever mounted second silently take the channel from the first and never
 * give it back.
 */
const handlers: ((files: File[]) => void)[] = [];

/** Turns what the native side described into the Files the app already speaks. */
async function collect(described: SharedFile[]): Promise<File[]> {
  const files = await Promise.all(
    described.map(async (item) => {
      try {
        const response = await fetch(item.url);
        if (!response.ok) return undefined;
        const blob = await response.blob();
        // The provider's type wins over whatever the fetch reported: it is the
        // one the sending app declared, and it is what the name matches.
        return new File([blob], item.name, { type: item.type || blob.type });
      } catch {
        // A grant that expired, or a provider that closed. One file failing is
        // not a reason to drop the rest of the share.
        return undefined;
      }
    }),
  );

  return files.filter((file) => file !== undefined);
}

/**
 * Registers a receiver for shared files.
 *
 * @returns the function that removes it, so a screen that has gone cannot
 * receive a share meant for the one that replaced it.
 */
export function receiveSharedFiles(onFiles: (files: File[]) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  handlers.push(onFiles);

  window.__pingoSharedFiles = (described) => {
    const innermost = handlers[handlers.length - 1];
    if (!innermost) return;
    void collect(described).then((files) => {
      if (files.length > 0) innermost(files);
    });
  };

  return () => {
    const at = handlers.lastIndexOf(onFiles);
    if (at !== -1) handlers.splice(at, 1);
    if (handlers.length === 0) delete window.__pingoSharedFiles;
  };
}

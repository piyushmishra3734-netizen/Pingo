import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { receiveKeyboardImages } from '../native/keyboard-image.js';
import { receiveSharedText } from '../native/shared-content.js';
import { receiveSharedFiles } from '../native/shared-files.js';
import { putShare } from './share-store.js';

/**
 * Content shared into PINGO from another app, routed to the share screen.
 *
 * ## Why this is mounted once, high up
 *
 * A share usually *starts* the app, so it arrives before any particular screen
 * exists. Listening from inside a composer would mean the content only lands if
 * somebody happens to have a chat open, which is exactly when they are least
 * likely to be sharing into it.
 *
 * ## Why it does not go straight into a chat
 *
 * The whole question a share asks is "who to". Dropping the text into whichever
 * thread happened to be open would answer that question wrongly and silently -
 * and on a phone, "whichever was open" is usually the last person you spoke to
 * rather than the one you meant.
 *
 * The keyboard is different and stays where it was: a GIF chosen in Gboard is
 * inserted into the field somebody is already typing in, and they have already
 * chosen who. That path is untouched.
 */
export function useIncomingShare(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const stopText = receiveSharedText((text) => {
      putShare({ text });
      navigate('/share');
    });

    /*
     * Shared files - any kind, all of them at once.
     *
     * Separate from the keyboard channel now. That channel carries base64 and
     * suits a sticker; a share can be a video, and it arrives as a URL to
     * stream instead. It also carries the file's real name, which the keyboard
     * channel has no way to know and a document cannot do without.
     */
    const stopFiles = receiveSharedFiles((files) => {
      putShare({ files });
      navigate('/share');
    });

    /*
     * The keyboard channel still routes here as a share when nothing else has
     * claimed it - a composer that is mounted takes an image as an insert, and
     * when none is, it is a share.
     */
    const stopImages = receiveKeyboardImages((file) => {
      putShare({ files: [file] });
      navigate('/share');
    });

    return () => {
      stopText();
      stopFiles();
      stopImages();
    };
  }, [navigate]);
}

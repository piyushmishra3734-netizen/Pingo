import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { receiveKeyboardImages } from '../native/keyboard-image.js';
import { receiveSharedText } from '../native/shared-content.js';
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
     * Images arrive on the keyboard channel because that is the one bridge
     * Java has for handing bytes to the page. A composer that is mounted takes
     * them as an insert; when none is, they are a share.
     */
    const stopImages = receiveKeyboardImages((file) => {
      putShare({ files: [file] });
      navigate('/share');
    });

    return () => {
      stopText();
      stopImages();
    };
  }, [navigate]);
}

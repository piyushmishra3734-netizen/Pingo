import { useEffect, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { SnapEditor } from '../camera/SnapEditor.js';

/**
 * A blank page to draw on and send, from the attach menu.
 *
 * It is the same editor and the same brushes as drawing on a photo, opened on
 * a plain dark sheet instead of a picture, so a sketch leaves as an ordinary
 * image message and nothing downstream needs to know the difference.
 */
export function SketchPad({ onCancel, onDone }: { onCancel: () => void; onDone: (file: File) => void }) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1440;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#15161b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    let url: string | undefined;
    let gone = false;
    canvas.toBlob((blob) => {
      if (!blob || gone) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }, 'image/png');
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  if (!src) return null;
  return (
    <Overlay onDismiss={onCancel}>
      <div className="fixed inset-0 z-500 bg-black">
        <SnapEditor
          src={src}
          startDrawing
          onCancel={onCancel}
          doneLabel="Send"
          onDone={(blob) => onDone(new File([blob], 'sketch.png', { type: blob.type || 'image/png' }))}
        />
      </div>
    </Overlay>
  );
}

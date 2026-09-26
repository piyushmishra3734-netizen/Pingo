import { useState } from 'react';

import { SnapCamera, type SnapShot } from '../../features/camera/snap/SnapCamera.js';
import { SnapShotEditor } from '../../features/camera/snap/SnapShotEditor.js';

/**
 * The Snap camera and what comes after the shutter, at `/dev/camera-lab`,
 * without a session. Sending needs one, so it fails here with a message; the
 * rest - lenses, music, recording, editing - runs as it does in the app.
 */
export function CameraLab() {
  const [shot, setShot] = useState<SnapShot>();
  return shot
    ? <SnapShotEditor shot={shot} onDone={() => setShot(undefined)} onPost={async () => { throw new Error('Sign in to post (this is the lab)'); }} />
    : <SnapCamera onShot={setShot} onGallery={(f) => setShot({ kind: f.type.startsWith('video/') ? 'video' : 'photo', blob: f })} onClose={() => history.back()} />;
}

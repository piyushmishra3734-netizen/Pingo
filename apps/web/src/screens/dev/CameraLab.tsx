import { useState } from 'react';

import { SnapCamera, type SnapShot } from '../../features/camera/snap/SnapCamera.js';
import { SnapPost } from '../../features/camera/snap/SnapPost.js';

/**
 * The Snap camera and what comes after the shutter, at `/dev/camera-lab`,
 * without a session. Sending needs one, so it fails here with a message; the
 * rest - lenses, music, recording, editing - runs as it does in the app.
 */
export function CameraLab() {
  const [shot, setShot] = useState<SnapShot>();
  return shot
    ? <SnapPost shot={shot} onRetake={() => setShot(undefined)} onSent={() => setShot(undefined)} />
    : <SnapCamera onShot={setShot} onGallery={(f) => setShot({ kind: f.type.startsWith('video/') ? 'video' : 'photo', blob: f })} onClose={() => history.back()} />;
}

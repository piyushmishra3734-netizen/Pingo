/**
 * Opens the camera facing the other way, for the flip button on a video call.
 *
 * ## Why the old camera may have to go first
 *
 * Most Android phones open one camera at a time. Asking for the rear one
 * while the front one is still streaming fails with `NotReadableError`
 * ("Could not start video source"), which is what made the flip button do
 * nothing at all on a phone: the error was caught, the call stayed on the
 * front camera, and nobody was told. So the first try keeps the old camera
 * running (a laptop with two webcams flips with no gap), and when that fails
 * the old one is stopped and the new one asked for again.
 *
 * ## Why `facingMode` alone is not trusted
 *
 * Some phones answer `facingMode: 'environment'` with the front camera again.
 * So the answer is checked against the camera already in use, and when it is
 * the same device the other cameras are tried by id, rear-looking labels
 * first when the rear is wanted.
 *
 * Kept apart from the call service, with the media devices passed in, so
 * `pnpm verify:flip-camera` can play a one-camera phone against it.
 */
export async function openOtherCamera(
  media: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>,
  wanted: 'user' | 'environment',
  current: MediaStreamTrack | undefined,
  constraints: MediaTrackConstraints,
): Promise<MediaStreamTrack | undefined> {
  const base: MediaTrackConstraints = { ...constraints, facingMode: wanted };
  const currentId = current?.getSettings().deviceId;
  const isNew = (t: MediaStreamTrack | undefined): boolean => Boolean(t) && (!currentId || t!.getSettings().deviceId !== currentId);
  const open = async (video: MediaTrackConstraints): Promise<MediaStreamTrack | undefined> => {
    try {
      const stream = await media.getUserMedia({ video, audio: false });
      return stream.getVideoTracks()[0];
    } catch {
      return undefined;
    }
  };

  // 1. Alongside the old camera: works wherever two can be open at once.
  let track = await open({ ...base, facingMode: { exact: wanted } });
  if (track && isNew(track)) return track;
  track?.stop();

  // 2. Let the old camera go, then ask again: the phone case.
  current?.stop();
  track = (await open({ ...base, facingMode: { exact: wanted } })) ?? (await open(base));
  if (track && isNew(track)) return track;
  track?.stop();

  // 3. By device: any other camera.
  const cameras = await media
    .enumerateDevices()
    .then((all) => all.filter((d) => d.kind === 'videoinput' && d.deviceId && d.deviceId !== currentId))
    .catch(() => [] as MediaDeviceInfo[]);
  const rear = (d: MediaDeviceInfo) => (/back|rear|environment/i.test(d.label) ? 1 : 0);
  cameras.sort((a, b) => (wanted === 'environment' ? rear(b) - rear(a) : rear(a) - rear(b)));
  const { facingMode: _facing, ...rest } = base;
  for (const camera of cameras) {
    track = await open({ ...rest, deviceId: { exact: camera.deviceId } });
    if (track) return track;
  }
  return undefined;
}

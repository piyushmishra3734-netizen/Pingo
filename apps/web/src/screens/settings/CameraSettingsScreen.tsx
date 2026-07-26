import {
  ChoiceRow,
  Group,
  SettingsPage,
  ToggleRow,
} from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Camera & Snaps.
 *
 * **Default Camera and Mirror are live** — the camera screen reads both, so
 * they change what happens the next time it opens. Everything else needs image
 * processing that does not exist yet.
 *
 * Mirror is worth a word: the *preview* is mirrored so it behaves like a
 * mirror, but the captured file never is, or text in a shot comes out
 * backwards. This toggle controls the preview only, which is what people mean
 * when they ask for it.
 */
export function CameraSettingsScreen() {
  const { preferences, update } = usePreferences();
  const c = preferences.camera;

  return (
    <SettingsPage title="Camera & Snaps">
      <Group title="Capture">
        <ChoiceRow
          label="Default Camera"
          description="Which one opens first."
          value={c.defaultCamera}
          options={[
            { value: 'front', label: 'Front' },
            { value: 'back', label: 'Back' },
          ]}
          onChange={(defaultCamera) => update('camera', { defaultCamera })}
        />
        <ToggleRow
          label="Mirror Camera"
          description="Mirrors the preview. Photos are never saved mirrored."
          checked={c.mirror}
          onChange={(mirror) => update('camera', { mirror })}
        />
      </Group>

      <Group title="Processing" note="These need image processing that is not built yet.">
        <ToggleRow
          label="Filters"
          checked={c.filters}
          onChange={(filters) => update('camera', { filters })}
        />
        <ToggleRow
          label="Beauty"
          description="Smooths skin. Off by default, and it stays that way unless you ask."
          checked={c.beauty}
          onChange={(beauty) => update('camera', { beauty })}
        />
        <ToggleRow
          label="HDR"
          checked={c.hdr}
          onChange={(hdr) => update('camera', { hdr })}
        />
      </Group>

      <Group title="Saving">
        <ToggleRow
          label="Save Snaps"
          description="Keep a copy of what you post."
          checked={c.saveSnaps}
          onChange={(saveSnaps) => update('camera', { saveSnaps })}
        />
        <ChoiceRow
          label="Upload Quality"
          value={c.uploadQuality}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'high', label: 'High' },
            { value: 'data-saver', label: 'Data saver' },
          ]}
          onChange={(uploadQuality) => update('camera', { uploadQuality })}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        Default Camera and Mirror take effect now. The rest are saved and start working when
        filters and upload transcoding are built.
      </p>
    </SettingsPage>
  );
}

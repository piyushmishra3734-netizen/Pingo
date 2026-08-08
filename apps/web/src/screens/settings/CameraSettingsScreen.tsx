import {
  ChoiceRow,
  Group,
  SettingsPage,
  ToggleRow,
} from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';
import { useT } from '../../features/i18n/useT.js';

/**
 * Camera & Pings.
 *
 * **Default Camera and Mirror are live** - the camera screen reads both, so
 * they change what happens the next time it opens. Everything else needs image
 * processing that does not exist yet.
 *
 * Mirror is worth a word: the *preview* is mirrored so it behaves like a
 * mirror, but the captured file never is, or text in a shot comes out
 * backwards. This toggle controls the preview only, which is what people mean
 * when they ask for it.
 */
export function CameraSettingsScreen() {
  const t = useT();
  const { preferences, update } = usePreferences();
  const c = preferences.camera;

  return (
    <SettingsPage title={t('page.camera')}>
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

      {/*
        Beauty and HDR are gone from this screen rather than left switched off.
        The group's note claimed all three "need image processing that is not
        built yet", which was wrong about Filters - the camera has had a working
        filter rail the whole time, and this switch was simply never wired to
        it. It is now. Beauty and HDR really are absent, and a switch for an
        absent feature is worse than no switch: it is a promise the product does
        not keep, and it comes back the day the processing exists.
      */}
      <Group title="Processing">
        <ToggleRow
          label="Filters"
          description="Show the filter picker in the camera."
          checked={c.filters}
          onChange={(filters) => update('camera', { filters })}
        />
      </Group>

      <Group title="Saving">
        <ToggleRow
          label="Save Pings"
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
        Everything here takes effect now except Upload Quality, which is saved and starts
        working when transcoding is built.
      </p>
    </SettingsPage>
  );
}

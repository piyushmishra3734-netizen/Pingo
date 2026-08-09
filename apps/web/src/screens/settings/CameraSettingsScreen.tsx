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
      <Group title={t('camSet.groupCapture')}>
        <ChoiceRow
          label={t('camSet.defaultCamera')}
          description={t('camSet.defaultCameraHint')}
          value={c.defaultCamera}
          options={[
            { value: 'front', label: t('choice.front') },
            { value: 'back', label: t('choice.back') },
          ]}
          onChange={(defaultCamera) => update('camera', { defaultCamera })}
        />
        <ToggleRow
          label={t('camSet.mirror')}
          description={t('camSet.mirrorHint')}
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
      <Group title={t('camSet.groupProcessing')}>
        <ToggleRow
          label={t('camSet.filters')}
          description={t('camSet.filtersHint')}
          checked={c.filters}
          onChange={(filters) => update('camera', { filters })}
        />
      </Group>

      <Group title={t('camSet.groupSaving')}>
        <ToggleRow
          label={t('camSet.savePings')}
          description={t('camSet.savePingsHint')}
          checked={c.saveSnaps}
          onChange={(saveSnaps) => update('camera', { saveSnaps })}
        />
        <ChoiceRow
          label={t('camSet.uploadQuality')}
          value={c.uploadQuality}
          options={[
            { value: 'auto', label: t('choice.auto') },
            { value: 'high', label: t('choice.high') },
            { value: 'data-saver', label: t('choice.dataSaver') },
          ]}
          onChange={(uploadQuality) => update('camera', { uploadQuality })}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">{t('camSet.footer')}</p>
    </SettingsPage>
  );
}

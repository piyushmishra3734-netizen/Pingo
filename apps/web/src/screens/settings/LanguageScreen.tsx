import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Language.
 *
 * One language, and the page says so rather than showing a list of options that
 * would each do nothing. PINGO has no translation layer — every string in the
 * product is written in English in the source — so a language picker would be
 * a menu of identical outcomes.
 *
 * The row is here because the section exists on the index and because the
 * honest answer to "can I change the language" is worth a screen.
 */

const LANGUAGES = [{ code: 'en', label: 'English', note: 'The only language for now' }];

export function LanguageScreen() {
  const { preferences } = usePreferences();

  return (
    <SettingsPage title="Language">
      <Group title="App language">
        {LANGUAGES.map((language) => (
          <InfoRow
            key={language.code}
            label={language.label}
            value={preferences.language === language.code ? 'Selected' : undefined}
          />
        ))}
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        More languages need a translation layer that PINGO does not have yet — every string
        is written in English in the source. A picker with one real option is the truthful
        version of this screen until that changes.
      </p>
    </SettingsPage>
  );
}

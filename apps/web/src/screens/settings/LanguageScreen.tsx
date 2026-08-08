import { cn } from '@pingo/ui';

import { useAppLanguage, useT } from '../../features/i18n/useT.js';
import { Group, SettingsPage } from '../../features/settings/controls.js';

/**
 * Language / voice.
 *
 * Two English *voices*, not two full locales yet:
 * default product English, and chronically-online (Gen-Z adjacent) chrome copy.
 */

export function LanguageScreen() {
  const t = useT();
  const { language, setLanguage, options } = useAppLanguage();

  return (
    <SettingsPage title={t('language.title')}>
      <Group title={t('language.group')}>
        <ul className="flex flex-col">
          {options.map((option) => {
            const selected = language === option.code;
            return (
              <li key={option.code}>
                <button
                  type="button"
                  onClick={() => setLanguage(option.code)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-3 py-3 text-left',
                    'transition-colors duration-instant ease-standard',
                    'hover:bg-hover active:bg-pressed focus-ring',
                    selected && 'bg-brand/8',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-body text-ink">{option.label}</span>
                    {selected ? (
                      <span className="text-caption font-medium text-brand">
                        {t('language.selected')}
                      </span>
                    ) : (
                      <span className="text-caption text-text-tertiary">{option.short}</span>
                    )}
                  </span>
                  <span className="text-caption text-text-secondary">{option.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">{t('language.hint')}</p>
    </SettingsPage>
  );
}

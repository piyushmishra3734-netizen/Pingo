import { useCallback, useMemo } from 'react';

import { usePreferences } from '../settings/SettingsContext.js';
import {
  APP_LANGUAGES,
  resolveLanguage,
  syncDocumentVoice,
  translate,
  type AppLanguage,
  type MessageKey,
} from './catalog.js';

/**
 * Product copy for the active voice (`en` or `en-genz`).
 *
 * ```tsx
 * const t = useT();
 * t('nav.chats') // "Chats" or "DMs"
 * ```
 */
export function useT() {
  const { preferences } = usePreferences();
  const language = resolveLanguage(preferences.language);

  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(language, key, vars),
    [language],
  );
}

export function useAppLanguage(): {
  language: AppLanguage;
  setLanguage: (code: AppLanguage) => void;
  options: typeof APP_LANGUAGES;
} {
  const { preferences, update } = usePreferences();
  const language = resolveLanguage(preferences.language);

  const setLanguage = useCallback(
    (code: AppLanguage) => {
      // Scalar preference: replace the whole field (see SettingsContext.update).
      update('language', code as never);
      syncDocumentVoice(code);
    },
    [update],
  );

  return useMemo(
    () => ({ language, setLanguage, options: APP_LANGUAGES }),
    [language, setLanguage],
  );
}

export { syncDocumentVoice } from './catalog.js';

import type { AppearanceSettings, Preferences } from '@pingo/core';

import type { AppLanguage } from '../i18n/catalog.js';

/**
 * The only settings PINGO AI can change, and how the app applies them.
 *
 * The same list is enforced by the database (`master_setting_ok`), which refuses
 * anything else before a card is ever drawn. It is checked again here because
 * this is the code that actually changes the app, and a list worth having is a
 * list worth having on both sides of the wire.
 *
 * Returns a function that puts the setting back, for the Undo button.
 */

export interface SettingsApi {
  preferences: Preferences;
  updateAppearance: (changes: Partial<AppearanceSettings>) => void;
  update: <K extends keyof Preferences>(group: K, changes: Partial<Preferences[K]>) => void;
  setLanguage: (code: AppLanguage) => void;
}

const THEMES = ['light', 'dark', 'auto'];
const LANGUAGES = ['en', 'en-genz', 'hi'];
const SIZES = ['small', 'medium', 'large'];
const BOOLS = ['true', 'false'];

export const SETTING_LABELS: Record<string, string> = {
  theme: 'Theme',
  language: 'App language',
  fontSize: 'Font size',
  muteAll: 'Mute all notifications',
  enterToSend: 'Enter to send',
};

export function describeSetting(key: string | undefined, value: string | undefined): string {
  const name = SETTING_LABELS[key ?? ''] ?? 'A setting';
  if (value === 'true') return `${name}: on`;
  if (value === 'false') return `${name}: off`;
  return `${name}: ${value ?? ''}`;
}

export function applySetting(api: SettingsApi, key: string, value: string): (() => void) | undefined {
  const { preferences } = api;
  switch (key) {
    case 'theme': {
      if (!THEMES.includes(value)) return undefined;
      const before = preferences.appearance.theme;
      api.updateAppearance({ theme: value as AppearanceSettings['theme'] });
      return () => api.updateAppearance({ theme: before });
    }
    case 'language': {
      if (!LANGUAGES.includes(value)) return undefined;
      const before = (preferences.language || 'en') as AppLanguage;
      api.setLanguage(value as AppLanguage);
      return () => api.setLanguage(before);
    }
    case 'fontSize': {
      if (!SIZES.includes(value)) return undefined;
      const before = preferences.chats.fontSize;
      api.update('chats', { fontSize: value as Preferences['chats']['fontSize'] });
      return () => api.update('chats', { fontSize: before });
    }
    case 'muteAll': {
      if (!BOOLS.includes(value)) return undefined;
      const before = preferences.notifications.muteAll;
      api.update('notifications', { muteAll: value === 'true' });
      return () => api.update('notifications', { muteAll: before });
    }
    case 'enterToSend': {
      if (!BOOLS.includes(value)) return undefined;
      const before = preferences.chats.enterToSend;
      api.update('chats', { enterToSend: value === 'true' });
      return () => api.update('chats', { enterToSend: before });
    }
    default:
      return undefined;
  }
}

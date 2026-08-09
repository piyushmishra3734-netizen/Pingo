import {
  ChoiceRow,
  Group,
  InfoRow,
  SettingsPage,
  ToggleRow,
} from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';
import { useNavigate } from 'react-router-dom';
import { WALLPAPERS, chosenGlobalWallpaperId } from '../../features/chat/wallpaper.js';
import { useT } from '../../features/i18n/useT.js';

/**
 * Chats.
 *
 * **Font Size is live.** It sets the root font size, and because every size in
 * the product is expressed in rem, the whole app resizes proportionally - not
 * just message text. Changing it here rescales this page while you look at it,
 * which is the point: you are reading the result at the size you picked.
 *
 * Enter to Send is live too. Wallpaper here is only the *default* for chats
 * that have not been personalised - open a chat's menu to set one for that
 * thread (shared for groups, personal for DMs).
 */
export function ChatsSettingsScreen() {
  const t = useT();
  const { preferences, update } = usePreferences();
  const navigate = useNavigate();
  const wallpaper = WALLPAPERS.find((w) => w.id === chosenGlobalWallpaperId());
  const c = preferences.chats;

  return (
    <SettingsPage title={t('page.chats')}>
      <Group title={t('chatsSet.groupReading')} note={t('chatsSet.fontNote')}>
        <ChoiceRow
          label={t('chatsSet.fontSize')}
          value={c.fontSize}
          options={[
            { value: 'small', label: t('choice.small') },
            { value: 'medium', label: t('choice.medium') },
            { value: 'large', label: t('choice.large') },
          ]}
          onChange={(fontSize) => update('chats', { fontSize })}
        />
        <ChoiceRow
          label={t('chatsSet.bubbleStyle')}
          value={c.bubbleStyle}
          options={[
            { value: 'rounded', label: t('chatsSet.bubbleRounded') },
            { value: 'classic', label: t('chatsSet.bubbleClassic') },
          ]}
          onChange={(bubbleStyle) => update('chats', { bubbleStyle })}
        />
        {/*
          Was a dead row reading "Default" that did nothing when tapped.
          It now goes where it always looked like it went.
        */}
        <InfoRow
          label={t('chatsSet.defaultWallpaper')}
          value={wallpaper?.name ?? t('choice.default')}
          onClick={() => navigate('/settings/wallpaper')}
        />
      </Group>

      <p className="px-1 pb-2 text-caption text-text-tertiary">{t('chatsSet.wallpaperHint')}</p>

      <Group title={t('chatsSet.groupMedia')}>
        <ChoiceRow
          label={t('chatsSet.autoDownload')}
          description={t('chatsSet.autoDownloadHint')}
          value={c.autoDownload}
          options={[
            { value: 'always', label: t('choice.always') },
            { value: 'wifi', label: t('choice.wifi') },
            { value: 'never', label: t('choice.never') },
          ]}
          onChange={(autoDownload) => update('chats', { autoDownload })}
        />
      </Group>

      <Group title={t('chatsSet.groupBehaviour')}>
        <ToggleRow
          label={t('chatsSet.enterToSend')}
          description={t('chatsSet.enterToSendHint')}
          checked={c.enterToSend}
          onChange={(enterToSend) => update('chats', { enterToSend })}
        />
        <ToggleRow
          label={t('chatsSet.swipeActions')}
          description={t('chatsSet.swipeActionsHint')}
          checked={c.swipeActions}
          onChange={(swipeActions) => update('chats', { swipeActions })}
        />
        <ToggleRow
          label={t('chatsSet.keepArchived')}
          description={t('chatsSet.keepArchivedHint')}
          checked={c.keepArchived}
          onChange={(keepArchived) => update('chats', { keepArchived })}
        />
        <ToggleRow
          label={t('chatsSet.pinAi')}
          description={t('chatsSet.pinAiHint')}
          checked={c.pinAiToTop}
          onChange={(pinAiToTop) => update('chats', { pinAiToTop })}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">{t('chatsSet.footer')}</p>
    </SettingsPage>
  );
}

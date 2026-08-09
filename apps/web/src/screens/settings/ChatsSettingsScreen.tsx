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
      <Group title="Reading" note="Font size rescales the entire app, not only messages.">
        <ChoiceRow
          label="Font Size"
          value={c.fontSize}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          onChange={(fontSize) => update('chats', { fontSize })}
        />
        <ChoiceRow
          label="Bubble Style"
          value={c.bubbleStyle}
          options={[
            { value: 'rounded', label: 'Rounded' },
            { value: 'classic', label: 'Classic' },
          ]}
          onChange={(bubbleStyle) => update('chats', { bubbleStyle })}
        />
        {/*
          Was a dead row reading "Default" that did nothing when tapped.
          It now goes where it always looked like it went.
        */}
        <InfoRow
          label="Default wallpaper"
          value={wallpaper?.name ?? 'Default'}
          onClick={() => navigate('/settings/wallpaper')}
        />
      </Group>

      <p className="px-1 pb-2 text-caption text-text-tertiary">
        Default wallpaper is the fallback for chats that have none of their own. Open a chat
        menu to set a wallpaper for that chat only - personal for DMs, shared for groups.
      </p>

      <Group title="Media">
        <ChoiceRow
          label="Auto Download"
          description="When to fetch photos and videos automatically."
          value={c.autoDownload}
          options={[
            { value: 'always', label: 'Always' },
            { value: 'wifi', label: 'Wi-Fi' },
            { value: 'never', label: 'Never' },
          ]}
          onChange={(autoDownload) => update('chats', { autoDownload })}
        />
      </Group>

      <Group title="Behaviour">
        <ToggleRow
          label="Enter to Send"
          description="Off means Enter adds a newline and the send button posts."
          checked={c.enterToSend}
          onChange={(enterToSend) => update('chats', { enterToSend })}
        />
        <ToggleRow
          label="Swipe Actions"
          description="Swipe a chat right to pin it, left to archive it."
          checked={c.swipeActions}
          onChange={(swipeActions) => update('chats', { swipeActions })}
        />
        <ToggleRow
          label="Keep Chats Archived"
          description="On, archived chats stay archived when new messages arrive. Off, they return to the list."
          checked={c.keepArchived}
          onChange={(keepArchived) => update('chats', { keepArchived })}
        />
        <ToggleRow
          label="Keep PINGO near the top"
          description="Unread chats from people still come first. Off uses ordinary pin and recency only."
          checked={c.pinAiToTop}
          onChange={(pinAiToTop) => update('chats', { pinAiToTop })}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        Font Size, Enter to Send, Swipe Actions, Keep Chats Archived, Keep PINGO near the top and
        wallpapers take effect now. Bubble style and auto-download are saved for when those features
        ship fully.
      </p>
    </SettingsPage>
  );
}

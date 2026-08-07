import {
  ChoiceRow,
  Group,
  InfoRow,
  SettingsPage,
  ToggleRow,
} from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';
import { useNavigate } from 'react-router-dom';
import { WALLPAPERS, chosenWallpaperId } from '../../features/chat/wallpaper.js';

/**
 * Chats.
 *
 * **Font Size is live.** It sets the root font size, and because every size in
 * the product is expressed in rem, the whole app resizes proportionally - not
 * just message text. Changing it here rescales this page while you look at it,
 * which is the point: you are reading the result at the size you picked.
 *
 * Enter to Send is live too. The rest save a preference that nothing reads yet,
 * and the note says so.
 */
export function ChatsSettingsScreen() {
  const { preferences, update } = usePreferences();
  const navigate = useNavigate();
  const wallpaper = WALLPAPERS.find((w) => w.id === chosenWallpaperId());
  const c = preferences.chats;

  return (
    <SettingsPage title="Chats">
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
          label="Chat Wallpaper"
          value={wallpaper?.name ?? 'Default'}
          onClick={() => navigate('/settings/wallpaper')}
        />
      </Group>

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
        Font Size, Enter to Send, Swipe Actions, Keep Chats Archived and Keep PINGO near the top
        take effect now. Wallpaper, bubble style and auto-download are saved and start working when
        those features are built.
      </p>
    </SettingsPage>
  );
}

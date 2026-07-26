import {
  ChoiceRow,
  Group,
  InfoRow,
  SettingsPage,
  ToggleRow,
} from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Chats.
 *
 * **Font Size is live.** It sets the root font size, and because every size in
 * the product is expressed in rem, the whole app resizes proportionally — not
 * just message text. Changing it here rescales this page while you look at it,
 * which is the point: you are reading the result at the size you picked.
 *
 * Enter to Send is live too. The rest save a preference that nothing reads yet,
 * and the note says so.
 */
export function ChatsSettingsScreen() {
  const { preferences, update } = usePreferences();
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
        <InfoRow label="Chat Wallpaper" value="Default" />
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
          description="Swipe a row to archive or mute."
          checked={c.swipeActions}
          onChange={(swipeActions) => update('chats', { swipeActions })}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        Font Size and Enter to Send take effect now. Wallpaper, bubble style, auto-download
        and swipe actions are saved and start working when those features are built.
      </p>
    </SettingsPage>
  );
}

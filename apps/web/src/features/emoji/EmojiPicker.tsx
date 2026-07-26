import { useEffect, useRef } from 'react';

import { useAppearance } from '../settings/SettingsContext.js';

/**
 * The emoji picker — emoji-mart (MIT).
 *
 * ## Why the vanilla build rather than `@emoji-mart/react`
 *
 * The React wrapper declares `react@"^16.8 || ^17 || ^18"` and PINGO is on 19,
 * so installing it warns and pins the project to an unmaintained bound. The
 * wrapper is also barely more than what is below — it mounts the vanilla Picker
 * into a ref on mount. Using the core directly removes the peer conflict and
 * the dependency at the same time.
 *
 * ## Data is fetched, not bundled
 *
 * `@emoji-mart/data` is ~1 MB of names, keywords and skin-tone variants for
 * every Unicode emoji. Imported statically it lands in the main bundle for
 * everyone; imported dynamically it arrives the first time somebody opens the
 * picker, which is the only moment it is useful.
 */

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose?: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const host = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useAppearance();

  useEffect(() => {
    let picker: { remove?: () => void } | undefined;
    let cancelled = false;

    void (async () => {
      const [{ Picker }, data] = await Promise.all([
        import('emoji-mart'),
        import('@emoji-mart/data').then((module) => module.default),
      ]);

      if (cancelled || !host.current) return;

      picker = new Picker({
        data,
        parent: host.current,
        // Follows the app's theme rather than the OS, so it matches the screen
        // it is sitting on when the two disagree.
        theme: resolvedTheme,
        previewPosition: 'none',
        skinTonePosition: 'search',
        navPosition: 'bottom',
        perLine: 8,
        onEmojiSelect: (emoji: { native?: string }) => {
          if (emoji.native) onSelect(emoji.native);
        },
        onClickOutside: onClose,
      }) as { remove?: () => void };
    })();

    return () => {
      cancelled = true;
      // The Picker appends a custom element; removing the host's children is
      // what actually detaches it.
      if (host.current) host.current.innerHTML = '';
      picker?.remove?.();
    };
    // Rebuilt on theme change — emoji-mart bakes the theme in at construction.
  }, [onSelect, onClose, resolvedTheme]);

  return <div ref={host} className="emoji-picker-host" />;
}

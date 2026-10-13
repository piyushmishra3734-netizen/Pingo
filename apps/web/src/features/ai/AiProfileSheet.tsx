import { AiProfilePage, type ProfilePageId } from './profile/AiProfilePage.js';

/**
 * PINGO AI's profile. The name is kept so every place that opened the old
 * sheet (chat info, settings) opens the profile page now.
 */
export function AiProfileSheet({
  conversationId,
  onClose,
  onChanged,
  onExit,
  onCall,
  start,
}: {
  conversationId?: string;
  onClose: () => void;
  onChanged?: () => void;
  onExit?: () => void;
  onCall?: () => void;
  start?: ProfilePageId;
}) {
  return (
    <AiProfilePage
      conversationId={conversationId}
      onClose={onClose}
      onChanged={onChanged}
      onExit={onExit}
      onCall={onCall}
      {...(start ? { start } : {})}
    />
  );
}

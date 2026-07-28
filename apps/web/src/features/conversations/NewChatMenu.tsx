import { ChevronRightIcon, UserIcon, UsersIcon } from '@pingo/ui';
import { useNavigate } from 'react-router-dom';

import { Sheet } from '../../components/Sheet.js';

/**
 * What the `+` opens.
 *
 * It used to go straight to the contact list, which was right while starting a
 * chat was the only thing you could start. Now there are two, and a `+` that
 * silently picks one of them makes the other undiscoverable — there is nowhere
 * else a group could plausibly be created from.
 *
 * Two rows and no more. A menu that grows past about four entries stops being a
 * choice and starts being a screen, and this one is opened by reflex.
 */
export function NewChatMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();

  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };

  return (
    <Sheet title="Start something" onClose={onClose}>
      <ul className="flex flex-col">
        <li>
          <Row
            icon={<UserIcon size={20} />}
            title="New chat"
            detail="Message someone you already know"
            onClick={go('/chats/new')}
          />
        </li>
        <li>
          <Row
            icon={<UsersIcon size={20} />}
            title="New group"
            detail="Add friends, or share a link with anyone"
            onClick={go('/chats/new-group')}
          />
        </li>
      </ul>
    </Sheet>
  );
}

function Row({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-md px-1 py-3 text-left transition-colors duration-quick hover:bg-surface-hover active:bg-surface-active"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        <span className="block truncate text-caption text-text-tertiary">{detail}</span>
      </span>
      <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
    </button>
  );
}

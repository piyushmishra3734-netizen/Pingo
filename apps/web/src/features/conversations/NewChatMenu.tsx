import { useChat } from '@pingo/core';
import { ChatIcon, ChevronRightIcon, UserIcon, UsersIcon, cn } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Sheet } from '../../components/Sheet.js';
import { useT } from '../i18n/useT.js';

/**
 * What the `+` opens.
 *
 * It used to go straight to the contact list, which was right while starting a
 * chat was the only thing you could start. Now there are a few doors, and a `+`
 * that silently picks one makes the rest undiscoverable.
 *
 * Keep this short. A menu that grows past about four entries stops being a
 * choice and starts being a screen, and this one is opened by reflex.
 */
export function NewChatMenu({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { service } = useChat();
  const [openingAi, setOpeningAi] = useState(false);
  const [aiError, setAiError] = useState<string>();

  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };

  const openPingo = async () => {
    if (openingAi) return;
    setOpeningAi(true);
    setAiError(undefined);
    try {
      const id = await service.ensureAiConversation();
      onClose();
      navigate(`/chats/${id}`);
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : t('common.error'));
      setOpeningAi(false);
    }
  };

  return (
    <Sheet title={t('chats.menuStart')} onClose={onClose}>
      <ul className="flex flex-col">
        <li>
          <Row
            icon={<ChatIcon size={20} />}
            title={t('chats.menuAi')}
            detail={t('chats.menuAiDetail')}
            onClick={() => void openPingo()}
            disabled={openingAi}
          />
        </li>
        <li>
          <Row
            icon={<UserIcon size={20} />}
            title={t('chats.menuNew')}
            detail={t('chats.menuNewDetail')}
            onClick={go('/chats/new')}
          />
        </li>
        <li>
          <Row
            icon={<UsersIcon size={20} />}
            title={t('chats.menuGroup')}
            detail={t('chats.menuGroupDetail')}
            onClick={go('/chats/new-group')}
          />
        </li>
      </ul>
      {aiError && (
        <p className="mt-2 px-1 text-center text-caption text-danger/90" role="alert">
          {aiError}
        </p>
      )}
    </Sheet>
  );
}

function Row({
  icon,
  title,
  detail,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3.5 rounded-md px-1 py-3 text-left transition-colors duration-quick',
        'hover:bg-surface-hover active:bg-surface-active',
        disabled && 'opacity-60',
      )}
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

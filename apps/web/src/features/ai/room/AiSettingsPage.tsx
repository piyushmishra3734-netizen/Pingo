import { useChat } from '@pingo/core';
import { Toggle } from '@pingo/ui';
import {
  Bell,
  Brain,
  Eye,
  CircleHelp,
  Globe,
  Languages,
  MessagesSquare,
  Moon,
  Palette,
  Phone,
  Shield,
  SlidersHorizontal,
  Trash2,
  Type,
  UserRound,
  Waves,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useConfirm } from '../../../components/ConfirmProvider.js';
import { AiMemoriesSheet } from '../AiMemoriesSheet.js';
import { AiProfileSheet } from '../AiProfileSheet.js';
import { PingoFlow } from '../flow/PingoFlow.js';
import { FLOW_COLOURS, setFlowColour, setFlowMotion, useFlowColour, useFlowMotion } from '../flow/flow-face.js';
import { orderedLanguages, PERSONALITIES, RESPONSE_LENGTHS, type PersonalityId } from '../personalities.js';
import { AI_VOICES, setAiVoice, useAiPrefs, useAiVoice } from './ai-prefs.js';
import { AiPanel, Choices, Group, PageHeader, Row } from './ui.js';

type Page = 'home' | 'behavior' | 'language' | 'voice' | 'data';

/**
 * PINGO AI's settings, as one page of groups: who it is, how it behaves,
 * what it remembers, your data, calls, how it looks and where it speaks.
 * Every row does something real; the app-wide ones (theme, notifications)
 * open the app's own screens.
 */
export function AiSettingsPage({ conversationId, onClose }: { conversationId?: string | undefined; onClose: () => void }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { service } = useChat();
  const { prefs, save, memoryCount, refreshMemoryCount, resetMemory } = useAiPrefs();
  const flowColour = useFlowColour();
  const voice = useAiVoice();
  const motion = useFlowMotion();
  const [page, setPage] = useState<Page>('home');
  const [profileOpen, setProfileOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);

  const personality = (prefs.personality as PersonalityId) || 'friendly';
  const length = prefs.response_length ?? 'short';
  const langs = orderedLanguages(typeof navigator !== 'undefined' ? navigator.language : undefined);
  const langLabel = langs.find((l) => l.id === (prefs.language ?? 'en'))?.label ?? 'English';
  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const body =
    page === 'behavior' ? (
      <div className="flex flex-col gap-6">
        <Group title="Personality">
          <Choices
            options={PERSONALITIES.map((p) => ({ id: p.id, label: p.label, hint: p.hint }))}
            value={personality}
            onPick={(id) => void save({ personality: id })}
          />
        </Group>
        <Group title="Replies">
          <Choices
            options={RESPONSE_LENGTHS.map((l) => ({ id: l.id, label: l.label }))}
            value={length}
            onPick={(id) => void save({ response_length: id })}
          />
        </Group>
      </div>
    ) : page === 'language' ? (
      <Choices options={langs} value={prefs.language ?? 'en'} onPick={(id) => void save({ language: id })} />
    ) : page === 'voice' ? (
      <Group title="Voice on calls" footer="Used the next time you call PINGO AI.">
        <Choices options={AI_VOICES} value={voice as (typeof AI_VOICES)[number]['id']} onPick={setAiVoice} />
      </Group>
    ) : page === 'data' ? (
      <div className="flex flex-col gap-6">
        <Group>
          {conversationId && (
            <Row
              title="Clear this chat"
              sub="Messages leave your side. The chat stays."
              onClick={() =>
                void (async () => {
                  if (!(await confirm({ title: 'Clear this chat?', description: 'Messages leave your side. The chat stays.', confirmLabel: 'Clear' }))) return;
                  await service.clearConversations([conversationId]);
                  onClose();
                })()
              }
            />
          )}
          <Row
            title="Reset memory"
            sub="PINGO AI forgets everything it saved about you"
            onClick={() =>
              void (async () => {
                if (!(await confirm({ title: 'Reset memory?', description: 'Everything PINGO AI remembers about you is deleted.', confirmLabel: 'Reset' }))) return;
                await resetMemory();
              })()
            }
          />
          <Row
            title="Reset personality"
            sub="Back to Friendly, short replies"
            onClick={() => void save({ personality: 'friendly', custom_personality: null, response_length: 'short' })}
          />
        </Group>
        <p className="px-1 text-[13px] leading-snug text-text-tertiary">
          Messages to PINGO AI are processed so it can reply and those copies clear after about 24 hours. This chat is not end-to-end encrypted.
        </p>
      </div>
    ) : (
      <div className="flex flex-col gap-6">
        <Group title="Pingo AI">
          <Row
            icon={<UserRound size={21} />}
            title="Profile"
            sub="Name, photo, bio and what it calls you"
            onClick={() => setProfileOpen(true)}
          />
          <div className="flex items-center gap-3.5 border-t border-line px-4 py-3">
            <PingoFlow colour={flowColour} face="happy" className="size-12" label="Pingo Flow" />
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pingo Flow colour">
              {FLOW_COLOURS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  role="radio"
                  aria-checked={flowColour === c.hex}
                  aria-label={c.name}
                  onClick={() => setFlowColour(c.hex)}
                  className={
                    'size-8 rounded-full ring-1 ring-line active:scale-95 ' +
                    (flowColour === c.hex ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : '')
                  }
                  style={{ background: c.hex }}
                />
              ))}
            </div>
          </div>
        </Group>

        <Group title="Animation" footer="Off keeps Pingo Flow still. Its expressions still change.">
          <Row
            icon={<Waves size={21} />}
            title="Body motion"
            sub="Floating, breathing and the soft wobble"
            end={<Toggle checked={motion.body} onChange={(body) => setFlowMotion({ body })} label="Body motion" />}
          />
          <Row
            icon={<Eye size={21} />}
            title="Face motion"
            sub="Blinking and looking around"
            end={<Toggle checked={motion.face} onChange={(face) => setFlowMotion({ face })} label="Face motion" />}
          />
        </Group>

        <Group title="AI & Personalization">
          <Row
            icon={<SlidersHorizontal size={21} />}
            title="AI behavior"
            sub={`${PERSONALITIES.find((p) => p.id === personality)?.label ?? 'Friendly'}, ${(RESPONSE_LENGTHS.find((l) => l.id === length)?.label ?? 'Short').toLowerCase()} replies`}
            onClick={() => setPage('behavior')}
          />
          <Row
            icon={<Brain size={21} />}
            title="Memory"
            sub={memoryCount > 0 ? `${memoryCount} things it remembers about you` : 'What PINGO AI remembers about you'}
            onClick={() => setMemoriesOpen(true)}
          />
          <Row
            icon={<MessagesSquare size={21} />}
            title="Remember me"
            sub="Let it save things you ask it to remember"
            end={<Toggle checked={prefs.memory_enabled !== false} onChange={(memory_enabled) => void save({ memory_enabled })} label="Remember me" />}
          />
        </Group>

        <Group title="Data & Privacy">
          <Row icon={<Shield size={21} />} title="Data controls" sub="Clear this chat, reset memory or personality" onClick={() => setPage('data')} />
        </Group>

        <Group title="Voice & Calls">
          <Row icon={<Phone size={21} />} title="Voice" sub={AI_VOICES.find((v) => v.id === voice)?.label ?? 'Marin'} onClick={() => setPage('voice')} />
        </Group>

        <Group title="Appearance">
          <Row icon={<Moon size={21} />} title="Theme" sub="Light, dark or system" onClick={() => go('/settings/appearance')} />
          <Row icon={<Palette size={21} />} title="Accent color" sub="Your messages take it" onClick={() => go('/settings/appearance')} />
          <Row icon={<Type size={21} />} title="Font size" sub="Across the app" onClick={() => go('/settings/appearance')} />
        </Group>

        <Group title="Language & Region">
          <Row icon={<Languages size={21} />} title="Reply language" sub={langLabel} onClick={() => setPage('language')} />
          <Row icon={<Globe size={21} />} title="App language" sub="Menus and buttons" onClick={() => go('/settings/language')} />
        </Group>

        <Group title="Notifications">
          <Row icon={<Bell size={21} />} title="Notifications" sub="Replies, reminders, messages" onClick={() => go('/settings/notifications')} />
        </Group>

        <Group title="Support">
          <Row icon={<CircleHelp size={21} />} title="Help & Support" sub="Questions, contact us" onClick={() => go('/settings/help')} />
        </Group>

        {conversationId && (
          <div className="overflow-hidden rounded-[20px] bg-danger/8 ring-1 ring-danger/15">
            <Row
              icon={<Trash2 size={21} />}
              danger
              title="Delete this chat"
              sub="Removed from your list. PINGO AI is still here from +."
              onClick={() =>
                void (async () => {
                  if (!(await confirm({ title: 'Delete this chat?', description: 'It is removed from your list.', confirmLabel: 'Delete' }))) return;
                  await service.deleteConversations([conversationId]);
                  go('/chats');
                })()
              }
            />
          </div>
        )}
      </div>
    );

  const titles: Record<Page, string> = { home: 'Settings', behavior: 'AI behavior', language: 'Reply language', voice: 'Voice', data: 'Data controls' };

  return (
    <>
      <AiPanel label="PINGO AI settings" onClose={onClose}>
        <PageHeader title={titles[page]} onBack={page === 'home' ? onClose : () => setPage('home')} />
        <div className="flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">{body}</div>
      </AiPanel>
      {profileOpen && <AiProfileSheet {...(conversationId ? { conversationId } : {})} onClose={() => setProfileOpen(false)} />}
      {memoriesOpen && (
        <AiMemoriesSheet
          onClose={() => {
            setMemoriesOpen(false);
            refreshMemoryCount();
          }}
        />
      )}
    </>
  );
}

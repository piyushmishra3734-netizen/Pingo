import { useChat } from '@pingo/core';
import { Toggle } from '@pingo/ui';
import {
  Bell,
  Brain,
  CircleHelp,
  Globe,
  Languages,
  MessagesSquare,
  Moon,
  Palette,
  Phone,
  Shield,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  Type,
  UserRound,
  Waves,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Coins, Loader2, Play, Square, Volume2 } from 'lucide-react';
import { playVoicePreview, stopVoicePreview } from '../profile/voice-preview.js';
import { getSupabaseClient } from '../../../lib/supabase/client.js';
import { callSoundsOn, setCallSounds } from '../../../lib/audio/call-sfx.js';

import { useConfirm } from '../../../components/ConfirmProvider.js';
import { MasterPanel } from '../../master/MasterPanel.js';
import { AiMemoriesSheet } from '../AiMemoriesSheet.js';
import { AiProfileSheet } from '../AiProfileSheet.js';
import { setFlowMotion, useFlowMotion } from '../flow/flow-face.js';
import { orderedLanguages, PERSONALITIES, RESPONSE_LENGTHS, type PersonalityId } from '../personalities.js';
import { AI_VOICES, useAiPrefs, useAiVoice } from './ai-prefs.js';
import { AiPanel, Choices, Group, PageHeader, Row } from './ui.js';

type Page = 'home' | 'behavior' | 'language' | 'voice' | 'data' | 'master';

/**
 * PINGO AI's settings, as one page of groups: who it is, how it behaves,
 * what it remembers, your data, calls, how it looks and where it speaks.
 * Every row does something real; the app-wide ones (theme, notifications)
 * open the app's own screens.
 */
export function AiSettingsPage({ conversationId, onClose, onCall }: { conversationId?: string | undefined; onClose: () => void; onCall?: () => void }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { service } = useChat();
  const { prefs, save, memoryCount, refreshMemoryCount, resetMemory } = useAiPrefs();
  const voice = useAiVoice();
  const motion = useFlowMotion();
  const [page, setPage] = useState<Page>('home');
  const [callSfx, setCallSfx] = useState(callSoundsOn);
  const [allowance, setAllowance] = useState<{ credits_left: number; credits_daily: number; call_seconds_left: number; unlimited: boolean }>();
  useEffect(() => {
    void getSupabaseClient().rpc('ai_allowance').then(({ data }) => setAllowance(data?.[0]));
  }, []);
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
        <VoiceChoices
          value={voice}
          speed={prefs.voice_speed ?? 1}
          language={prefs.voice_language ?? null}
          onPick={(id) => void save({ voice: id })}
        />
      </Group>
    ) : page === 'master' ? (
      <MasterPanel />
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
        </Group>

        <Group title="Today" footer="Free plan: 15 credits a day. A web search, a picture or /think costs 5; plain chat is free. Calls: 2 minutes a day. Both reset at midnight.">
          <Row
            icon={<Coins size={21} />}
            title={allowance ? (allowance.unlimited ? 'Unlimited' : `${allowance.credits_left} of ${allowance.credits_daily} credits left`) : 'Credits'}
            sub={allowance && !allowance.unlimited ? `${Math.floor(allowance.call_seconds_left / 60)}:${String(allowance.call_seconds_left % 60).padStart(2, '0')} of calls left` : 'Search, pictures and /think'}
          />
        </Group>

        <Group title="Calls">
          <Row
            icon={<Volume2 size={21} />}
            title="Call sounds"
            sub="A soft tone when a call connects, ends, mutes or unmutes"
            end={<Toggle checked={callSfx} onChange={(on) => { setCallSounds(on); setCallSfx(on); }} label="Call sounds" />}
          />
        </Group>

        <Group title="Animation" footer="Off keeps Pingo still.">
          <Row
            icon={<Waves size={21} />}
            title="Body motion"
            sub="Floating, hopping and the bob while it talks"
            end={<Toggle checked={motion.body} onChange={(body) => setFlowMotion({ body })} label="Body motion" />}
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
          <Row icon={<Sparkles size={21} />} title="PINGO Master" sub="Let PINGO AI message and set things up for you, with your approval" onClick={() => setPage('master')} />
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

  const titles: Record<Page, string> = { home: 'Settings', behavior: 'AI behavior', language: 'Reply language', voice: 'Voice', data: 'Data controls', master: 'PINGO Master' };

  return (
    <>
      <AiPanel label="PINGO AI settings" onClose={onClose}>
        <PageHeader title={titles[page]} onBack={page === 'home' ? onClose : () => setPage('home')} />
        <div className="flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2 lg:px-8">{body}</div>
      </AiPanel>
      {profileOpen && (
        <AiProfileSheet
          {...(conversationId ? { conversationId } : {})}
          onClose={() => setProfileOpen(false)}
          onExit={() => {
            setProfileOpen(false);
            onClose();
          }}
          {...(onCall
            ? {
                onCall: () => {
                  setProfileOpen(false);
                  onClose();
                  onCall();
                },
              }
            : {})}
        />
      )}
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

/**
 * The call voices, each with a play button: a few seconds of that voice from
 * OpenAI (ai-realtime's preview), at their speed and language, before picking.
 */
function VoiceChoices({
  value,
  speed,
  language,
  onPick,
}: {
  value: string;
  speed: number;
  language: string | null;
  onPick: (id: string) => void;
}) {
  const [playing, setPlaying] = useState<string>();
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState('');
  useEffect(() => () => stopVoicePreview(), []);

  const play = async (id: string) => {
    if (playing === id) {
      stopVoicePreview();
      setPlaying(undefined);
      return;
    }
    setError('');
    setLoading(id);
    try {
      await playVoicePreview({ voice: id, speed, language }, () => setPlaying((p) => (p === id ? undefined : p)));
      setPlaying(id);
    } catch (cause) {
      setPlaying(undefined);
      setError(cause instanceof Error ? cause.message : "Couldn't play that voice right now.");
    } finally {
      setLoading(undefined);
    }
  };

  return (
    <div role="radiogroup" aria-label="Call voice" className="flex flex-col">
      {AI_VOICES.map((v) => (
        <div key={v.id} className="flex items-center gap-2 border-t border-line px-3 py-2.5 first:border-t-0">
          <button
            type="button"
            role="radio"
            aria-checked={value === v.id}
            onClick={() => onPick(v.id)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span className="grid size-5 shrink-0 place-items-center text-brand">{value === v.id ? <Check size={18} /> : null}</span>
            <span className="min-w-0">
              <span className="block text-[16px] font-medium text-ink">{v.label}</span>
              <span className="block text-[13.5px] text-text-secondary">{v.hint}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label={playing === v.id ? `Stop ${v.label}` : `Play ${v.label}`}
            onClick={() => void play(v.id)}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-ink active:scale-95"
          >
            {loading === v.id ? <Loader2 size={17} className="animate-spin motion-reduce:animate-none" /> : playing === v.id ? <Square size={14} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
        </div>
      ))}
      {error && <p role="alert" className="px-3 pt-2 text-[13px] text-[#d92d20]">{error}</p>}
    </div>
  );
}

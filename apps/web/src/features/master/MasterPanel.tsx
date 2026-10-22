import { Toggle } from '@pingo/ui';
import { CalendarClock, MessageSquareShare, OctagonX, ScrollText, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Group, Row } from '../ai/room/ui.js';
import { describeSetting } from './applySetting.js';
import { cancel, configure, loadLog, loadSettings, sayError, whenLabel, type MasterAction, type MasterSettings } from './master.js';

/**
 * PINGO Master's page in PINGO AI's settings: the switch, what it may do, the
 * kill switch and everything it has done. Off until you turn it on, and turning
 * it off cancels whatever was waiting and gives the credits back.
 */

const STATUS: Record<MasterAction['status'], string> = {
  pending: 'Waiting for you',
  scheduled: 'Scheduled',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  declined: 'Not now',
  expired: 'Expired',
};

export function MasterPanel() {
  const confirm = useConfirm();
  const [settings, setSettings] = useState<MasterSettings>();
  const [log, setLog] = useState<MasterAction[]>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([loadSettings(), loadLog()]);
    setSettings(s);
    setLog(l);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (next: MasterSettings) => {
    setError(undefined);
    const before = settings;
    setSettings(next);
    try {
      await configure(next);
      setLog(await loadLog());
    } catch (e) {
      setSettings(before);
      setError(sayError(e instanceof Error ? e.message : undefined));
    }
  };

  const turnOn = async () => {
    const ok = await confirm({
      title: 'Turn on PINGO Master?',
      description:
        'PINGO AI can then propose messages and a few settings for you. Nothing happens until you tap Approve, and each task costs 5 credits. When it sends a message, the message says it was sent by PINGO AI.',
      confirmLabel: 'Turn on',
    });
    if (ok && settings) await save({ ...settings, enabled: true });
  };

  if (!settings) return <p className="px-1 text-[14px] text-text-secondary">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <Group
        footer="Master can only do what is listed here. It cannot touch passwords, your account, blocking, devices or payments, and it never acts without your Approve."
      >
        <Row
          icon={<Sparkles size={21} />}
          title="PINGO Master"
          sub={settings.enabled ? 'On. Ask PINGO AI to message someone or change a setting.' : 'Off'}
          end={<Toggle checked={settings.enabled} onChange={(on) => (on ? void turnOn() : void save({ ...settings, enabled: false }))} label="PINGO Master" />}
        />
      </Group>

      {settings.enabled && (
        <>
          <Group title="What it may propose">
            <Row
              icon={<MessageSquareShare size={21} />}
              title="Send messages"
              sub="From you, to chats you are already in"
              end={<Toggle checked={settings.allow_messages} onChange={(on) => void save({ ...settings, allow_messages: on })} label="Send messages" />}
            />
            <Row
              icon={<SlidersHorizontal size={21} />}
              title="Change settings"
              sub="Theme, language, font size, mute, Enter to send"
              end={<Toggle checked={settings.allow_settings} onChange={(on) => void save({ ...settings, allow_settings: on })} label="Change settings" />}
            />
          </Group>

          <Group
            title="Stop everything"
            footer="Cancels every waiting and scheduled task and gives their credits back."
          >
            <Row
              icon={<OctagonX size={21} />}
              title="Kill switch"
              sub="Turn Master off and cancel what is waiting"
              danger
              onClick={() => void save({ ...settings, enabled: false })}
            />
          </Group>
        </>
      )}

      <Group title="Activity" footer="Everything PINGO AI proposed, and what happened to it.">
        {log === undefined ? (
          <p className="px-4 py-3 text-[14px] text-text-secondary">Loading…</p>
        ) : log.length === 0 ? (
          <p className="px-4 py-3 text-[14px] text-text-secondary">Nothing yet.</p>
        ) : (
          log.map((a) => (
            <Row
              key={a.id}
              icon={a.kind === 'send_message' ? <CalendarClock size={21} /> : <ScrollText size={21} />}
              title={a.kind === 'send_message' ? (a.params.text ?? '').slice(0, 60) : describeSetting(a.params.key, a.params.value)}
              sub={`${STATUS[a.status]}${a.run_at && a.status === 'scheduled' ? ` · ${whenLabel(a.run_at)}` : ''} · ${new Date(a.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
              {...(a.status === 'scheduled'
                ? {
                    end: (
                      <button
                        type="button"
                        onClick={() => void cancel(a.id).then(refresh)}
                        className="rounded-full px-2.5 py-1 text-caption font-medium text-danger hover:bg-hover focus-ring"
                      >
                        Cancel
                      </button>
                    ),
                  }
                : {})}
            />
          ))
        )}
      </Group>

      {error && (
        <p role="alert" className="px-1 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

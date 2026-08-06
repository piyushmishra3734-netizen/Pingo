import { useAuth, useProfile } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';

import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';
import { currentPlatform, isNative } from '../../features/native/shell.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * What push actually did, for the person it happened to.
 *
 * ## Why this is a screen and not a log
 *
 * Every question about push is asked after the fact and away from a debugger:
 * "I did not get a notification." The answer is somewhere in a chain of eight
 * things - permission, a token, a preference, a trigger, an HTTP call, FCM, a
 * queue, a browser - and until now the only way to see any of it was a database
 * console. This puts the whole chain on one page, in the order it runs, so the
 * first row that is wrong is the answer.
 *
 * ## It shows their own rows, and health only to an operator
 *
 * Delivery records are readable per user by RLS. The aggregate numbers are not:
 * they describe the whole product, and `push_health()` refuses anybody not on
 * the allowlist. So this page is useful to a user reporting a problem and
 * complete to whoever is fixing it.
 */

interface Delivery {
  notification_id: string;
  device_count: number;
  latency_ms: number | null;
  attempts: number;
  sent_at: string;
}

interface Failure {
  reason: string;
  last_error: string | null;
  attempts: number;
  next_attempt_at: string;
}

interface Health {
  delivered: number;
  dead_letters: number;
  queued: number;
  pruned_tokens: number;
  retries_before_success: number;
  avg_latency_ms: number | null;
  success_rate_percent: number | null;
}

function when(iso: string | undefined): string {
  if (!iso) return '-';
  const at = new Date(iso);
  const seconds = Math.round((Date.now() - at.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return at.toLocaleDateString();
}

export function PushDebugScreen() {
  const { session } = useAuth();
  const { profile } = useProfile();
  const userId = session?.user.id;

  const [tokens, setTokens] = useState<{ token: string; platform: string; last_seen_at: string }[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [health, setHealth] = useState<Health | undefined>();
  const [swScopes, setSwScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const client = getSupabaseClient();

    const [t, d, f, h] = await Promise.all([
      client.from('device_tokens').select('token, platform, last_seen_at').eq('user_id', userId),
      client
        .from('push_deliveries')
        .select('notification_id, device_count, latency_ms, attempts, sent_at')
        .order('sent_at', { ascending: false })
        .limit(5),
      client
        .from('push_failures')
        .select('reason, last_error, attempts, next_attempt_at')
        .order('next_attempt_at', { ascending: true })
        .limit(5),
      // Refused for anybody not on the allowlist, which is not an error worth
      // showing - the rest of the page is still the useful part.
      client.rpc('push_health').then((r) => r, () => ({ data: null })),
    ]);

    setTokens((t.data as typeof tokens) ?? []);
    setDeliveries((d.data as Delivery[]) ?? []);
    setFailures((f.data as Failure[]) ?? []);
    const rows = (h as { data: Health[] | null }).data;
    setHealth(Array.isArray(rows) ? rows[0] : (rows as Health | null) ?? undefined);

    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      setSwScopes(regs.map((r) => new URL(r.scope).pathname));
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const permission =
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const latest = deliveries[0];

  return (
    <SettingsPage title="Push diagnostics">
      {/*
        In the order the chain runs. The first row that looks wrong is the
        answer, which is the only reason to put these on one page.
      */}
      <Group title="This device">
        <InfoRow label="Platform" value={isNative() ? currentPlatform() : 'web'} />
        <InfoRow label="Permission" value={permission} />
        <InfoRow
          label="Service workers"
          value={swScopes.length > 0 ? swScopes.join('  ') : 'none'}
        />
        <InfoRow
          label="Registered tokens"
          value={tokens.length === 0 ? 'none' : String(tokens.length)}
        />
        {tokens.map((t) => (
          <InfoRow
            key={t.token}
            label={t.platform}
            // Enough to recognise a token across two screens, never the whole
            // thing: it is a credential for delivering to this device.
            value={`${t.token.slice(0, 12)}…  ${when(t.last_seen_at)}`}
          />
        ))}
      </Group>

      <Group title="Last delivered">
        {latest ? (
          <>
            <InfoRow label="When" value={when(latest.sent_at)} />
            <InfoRow label="Devices reached" value={String(latest.device_count)} />
            <InfoRow
              label="Latency"
              value={latest.latency_ms === null ? '-' : `${(latest.latency_ms / 1000).toFixed(1)}s`}
            />
            <InfoRow label="Attempts" value={String(latest.attempts)} />
          </>
        ) : (
          <InfoRow label="Nothing delivered yet" />
        )}
      </Group>

      <Group
        title="Queue"
        note={
          failures.length === 0
            ? 'Nothing waiting to be retried.'
            : 'Waiting on the retry worker, which runs every minute.'
        }
      >
        {failures.length === 0 ? (
          <InfoRow label="Empty" />
        ) : (
          failures.map((f, index) => (
            <InfoRow
              key={index}
              label={`${f.reason} (attempt ${f.attempts})`}
              value={`retry ${when(f.next_attempt_at)}`}
            />
          ))
        )}
      </Group>

      {failures[0]?.last_error && (
        <Group title="Last error">
          <div className="px-3 py-3">
            <p className="break-words font-mono text-caption text-text-secondary">
              {failures[0].last_error}
            </p>
          </div>
        </Group>
      )}

      {/*
        Only rendered when `push_health()` answered, which it does for an
        operator and refuses for everybody else. An empty section is better
        than a row of dashes explaining that you may not look.
      */}
      {health && (
        <Group title="Health" note="Across the whole product, last 30 days.">
          <InfoRow
            label="Success rate"
            value={health.success_rate_percent === null ? '-' : `${health.success_rate_percent}%`}
          />
          <InfoRow
            label="Average latency"
            value={
              health.avg_latency_ms === null ? '-' : `${(health.avg_latency_ms / 1000).toFixed(1)}s`
            }
          />
          <InfoRow label="Delivered" value={String(health.delivered)} />
          <InfoRow label="Dead letters" value={String(health.dead_letters)} />
          <InfoRow label="Queued" value={String(health.queued)} />
          <InfoRow label="Pruned tokens" value={String(health.pruned_tokens)} />
          <InfoRow label="Retries before success" value={String(health.retries_before_success)} />
        </Group>
      )}

      <Button variant="secondary" size="lg" block loading={loading} onClick={() => void load()}>
        Refresh
      </Button>

      <p className={cn('mt-4 px-1 pb-4 text-caption text-text-tertiary')}>
        Signed in as @{profile?.username ?? '…'}. Everything above is your own delivery record;
        the health figures are shown only to an operator.
      </p>
    </SettingsPage>
  );
}

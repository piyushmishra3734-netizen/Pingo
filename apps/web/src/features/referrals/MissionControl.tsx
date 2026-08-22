import { Button } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * The mission, as the operator sees it in Controlling.
 *
 * ## Why the requirement is editable at all
 *
 * "Refer five friends" is a product decision that will be wrong at least once -
 * five is a guess about how hard the badge should be, and the only way to find
 * out is to watch people try. Baking it into a build means the answer to "make
 * it three" is a deploy, an APK, and a wait; here it is a number in a box.
 *
 * The rest of the app reads it from `referral_progress`, so changing it moves
 * the progress bar, the copy and the unlock threshold together. Nothing else
 * knows the number.
 *
 * ## What lowering it does, and what it does not
 *
 * Lowering the requirement does not sweep through and award the badge to
 * everybody who now qualifies - the award happens when a referral lands. It
 * would be easy to add and it is deliberately not here: an operator dragging a
 * number down should not fire off a hundred unlocks before they have looked at
 * what the number does. The next referral each of them earns will unlock it.
 */

interface MissionRow {
  id: string;
  title: string;
  description: string;
  required_count: number;
  enabled: boolean;
}

export function MissionControl() {
  const [mission, setMission] = useState<MissionRow>();
  const [required, setRequired] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  const refresh = useCallback(async () => {
    const { data } = await getSupabaseClient()
      .from('missions')
      .select('id,title,description,required_count,enabled')
      .order('created_at')
      .limit(1);
    const row = (data ?? [])[0] as MissionRow | undefined;
    if (row) {
      setMission(row);
      setRequired(String(row.required_count));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!mission) return;
    const next = Number(required);
    // A requirement of zero would unlock for everybody who has ever opened the
    // screen, which is not a mission. The database refuses it too.
    if (!Number.isInteger(next) || next < 1) {
      setNote('The requirement has to be a whole number, one or more.');
      return;
    }

    setBusy(true);
    setNote(undefined);
    const { error } = await getSupabaseClient()
      .from('missions')
      .update({ required_count: next, enabled: mission.enabled, updated_at: new Date().toISOString() })
      .eq('id', mission.id);
    setBusy(false);
    setNote(error ? `Could not save: ${error.message}` : 'Saved.');
    if (!error) await refresh();
  };

  const toggle = async () => {
    if (!mission) return;
    setBusy(true);
    const { error } = await getSupabaseClient()
      .from('missions')
      .update({ enabled: !mission.enabled, updated_at: new Date().toISOString() })
      .eq('id', mission.id);
    setBusy(false);
    setNote(error ? `Could not save: ${error.message}` : 'Saved.');
    if (!error) await refresh();
  };

  if (!mission) return null;

  return (
    <section className="mb-4 rounded-lg bg-surface p-3 shadow-sm">
      <h2 className="mb-1 text-body font-semibold text-ink">Mission — {mission.title}</h2>
      <p className="mb-3 text-caption text-text-secondary">
        {mission.description} The whole app reads this number; nothing has its own copy.
      </p>

      <label className="mb-3 block">
        <span className="text-caption font-medium text-text-secondary">Friends required</span>
        <input
          type="number"
          min={1}
          value={required}
          onChange={(event) => setRequired(event.target.value)}
          className="focus-ring text-body mt-1 w-28 rounded-lg border border-hairline bg-page px-3 py-2 text-ink"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void toggle()}>
          {mission.enabled ? 'Disable mission' : 'Enable mission'}
        </Button>
        <span className="text-caption text-text-secondary">
          {mission.enabled ? 'Running' : 'Off — no referrals are counted'}
        </span>
      </div>

      {note ? <p className="mt-2 text-caption text-text-secondary">{note}</p> : null}
    </section>
  );
}

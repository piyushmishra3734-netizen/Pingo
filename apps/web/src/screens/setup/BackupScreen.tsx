import { useProfile } from '@pingo/core';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';
import { EnrolmentFlow } from '../../features/backup/EnrolmentFlow.js';
import { ServerBackupTarget } from '../../lib/backup/server-target.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { SETUP_PROGRESS } from './progress.js';

/**
 * Setup, step 5 - Secure Backup.
 *
 * Offered here because this is the only moment when "only future messages will
 * be recoverable" costs the user nothing: there are no past messages yet. The
 * same screen shown a month later is an apology; shown now it is simply the
 * truth, and enrolling takes the whole warning away.
 *
 * ## Skipping is a real option, and stays one
 *
 * Nothing here is required to finish setup, and declining leaves no package and
 * no local state - Settings offers exactly this again, through the same
 * component, whenever they want it. A recovery key belongs to somebody who
 * asked for one; enrolling people by default would hand every account a secret
 * they never chose to keep.
 */
export function BackupScreen() {
  const navigate = useNavigate();
  const client = useMemo(() => getSupabaseClient(), []);
  const targets = useMemo(() => [new ServerBackupTarget(client)], [client]);

  const done = () => navigate('/setup/people', { replace: true });

  /*
   * The passkey prompt shows a name, and at this point in setup the profile
   * already exists — the handle was chosen two steps ago. Without it the
   * passkey option would appear and then fail on tap, so it is passed here
   * rather than left to be discovered.
   */
  const { profile } = useProfile();
  const account = profile
    ? { userId: profile.id, userName: profile.username, displayName: profile.displayName }
    : undefined;

  return (
    <AuthScreen
      progress={SETUP_PROGRESS.backup}
      title="Secure Backup"
      subtitle="Keep your chats if you lose this phone."
    >
      {/*
        The sequence, the warning and the cancel semantics all live in
        EnrolmentFlow, shared with Settings. Two copies would eventually
        disagree about the one sentence that must not change.
      */}
      <EnrolmentFlow
        targets={targets}
        {...(account ? { account } : {})}
        onDone={done}
        onCancel={done}
        cancelLabel="Not now"
      />
    </AuthScreen>
  );
}

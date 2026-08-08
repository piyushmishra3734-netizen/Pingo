import { BellIcon, Button } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { useT } from '../../features/i18n/useT.js';
import { SETUP_PROGRESS } from './progress.js';

/**
 * Setup, step 4 - notifications.
 *
 *   Allow Notifications
 *   Stay updated.
 *   [ Allow ]  ·  Skip
 *
 * One screen, one permission. Contacts comes later, and camera is asked for
 * only when the camera is opened - a permission requested before the feature
 * that needs it is a permission spent on nothing.
 *
 * ## Why we ask before the browser asks
 *
 * The browser prompt can only be shown once. Spend it without context and the
 * app ends up permanently muted with no way back
 * ([docs/01 § 11](../../../../../docs/01-onboarding-auth.md#11-notifications)).
 * So this screen earns the yes, *then* triggers the real prompt. **Skip never
 * triggers it**, which is what keeps the option alive for later.
 *
 * *"Only messages and calls. Nothing else."* is a commitment the product then
 * has to keep - no marketing pushes, no re-engagement nudges, no "you have
 * unread messages" reminders.
 */

type Outcome = 'granted' | 'denied' | 'unsupported';

export function PermissionsScreen() {
  const t = useT();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | undefined>();

  const done = () => navigate('/setup/backup', { replace: true });

  const allow = async () => {
    if (!('Notification' in window)) {
      setOutcome('unsupported');
      done();
      return;
    }

    setAsking(true);
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        done();
        return;
      }
      /*
       * Denied, or dismissed. Not an error and not a dead end - the user is
       * moved along either way, because nothing here depends on the answer.
       */
      setOutcome('denied');
    } catch {
      setOutcome('denied');
    } finally {
      setAsking(false);
    }
  };

  return (
    <AuthScreen
      progress={SETUP_PROGRESS.permissions}
      title={t('setup.permissionsTitle')}
      subtitle={t('setup.permissionsSub')}
      showBack={false}
      message={
        outcome === 'denied' ? (
          <AuthMessage tone="muted">
            Notifications are off. You can turn them on later in Settings.
          </AuthMessage>
        ) : undefined
      }
      footer={
        <div className="flex flex-col gap-3">
          {outcome === 'denied' ? (
            <Button variant="primary" size="lg" block onClick={done}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" size="lg" block loading={asking} onClick={allow}>
              Allow
            </Button>
          )}
          {/* Never triggers the browser prompt - that is the whole point. */}
          <Button variant="text" size="lg" block onClick={done} disabled={asking}>
            Skip
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-sunken text-brand">
          <BellIcon size={28} />
        </span>

        <p className="mt-7 max-w-[19rem] text-body text-text-secondary">
          We'll only notify you about messages and calls. Nothing else. Ever.
        </p>
        <p className="mt-3 max-w-[19rem] text-caption text-text-tertiary">
          You can change this anytime in Settings.
        </p>
      </div>
    </AuthScreen>
  );
}

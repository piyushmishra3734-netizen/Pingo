import { AuthError } from '@pingo/core';
import { useState } from 'react';

import {
  CautionCard,
  SecurePhoneSheet,
  type SecurePhoneApi,
  type SecureStep,
} from '../../features/auth/SecurePhoneSheet.js';

/**
 * The caution card and the add-your-number sheet, at `/dev/secure-lab`, with a
 * pretend backend.
 *
 * The real one needs a session with no number and places a real call, so this
 * hands the sheet an API that answers after a moment instead: any number
 * ending 0000 is "taken", the code is 123456, and passwords always save. The
 * card opens the sheet the way the app does; the buttons open it at each step.
 */
const STEPS: SecureStep[] = ['phone', 'code', 'password', 'done'];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PRETEND: SecurePhoneApi = {
  start: async (e164) => {
    await wait(700);
    return e164.endsWith('0000') ? { status: 'taken' } : { status: 'sent', ending: e164.slice(-2) };
  },
  verify: async (_e164, code) => {
    await wait(600);
    if (code !== '123456') throw new AuthError('invalid_credentials', 'That code did not work.');
  },
  setPassword: async () => {
    await wait(600);
  },
};

export function SecurePhoneLab() {
  const [step, setStep] = useState<SecureStep>('phone');
  const [take, setTake] = useState(0);
  const [open, setOpen] = useState(false);

  const openAt = (s: SecureStep) => {
    setStep(s);
    setTake((n) => n + 1);
    setOpen(true);
  };

  return (
    <div className="h-full bg-page">
      {!open && <CautionCard onAdd={() => openAt('phone')} onLater={() => undefined} />}
      <div className="flex flex-wrap gap-2 p-4">
        {STEPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => openAt(s)}
            className={
              open && step === s
                ? 'rounded-md bg-brand px-3 py-1.5 text-caption font-medium text-on-brand'
                : 'rounded-md bg-surface px-3 py-1.5 text-caption font-medium text-text-secondary'
            }
          >
            {s}
          </button>
        ))}
      </div>
      {open && (
        <SecurePhoneSheet key={take} initialStep={step} api={PRETEND} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

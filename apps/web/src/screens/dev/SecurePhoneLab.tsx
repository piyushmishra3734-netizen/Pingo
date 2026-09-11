import { AuthError } from '@pingo/core';
import { useState } from 'react';

import {
  SecurePhoneSheet,
  type SecurePhoneApi,
  type SecureStep,
} from '../../features/auth/SecurePhoneSheet.js';

/**
 * The add-your-number sheet, at `/dev/secure-lab`, with a pretend backend.
 *
 * The real one needs a session with no number and places a real call, so this
 * hands the sheet an API that answers after a moment instead: any number
 * ending 0000 is "taken", the code is 123456, and passwords always save. The
 * buttons open it at each step, and closing it opens it again.
 */
const STEPS: SecureStep[] = ['intro', 'phone', 'code', 'password', 'done'];

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
  const [step, setStep] = useState<SecureStep>('intro');
  const [take, setTake] = useState(0);

  return (
    <div className="h-full bg-sunken p-4">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStep(s);
              setTake((n) => n + 1);
            }}
            className={
              step === s
                ? 'rounded-md bg-brand px-3 py-1.5 text-caption font-medium text-on-brand'
                : 'rounded-md bg-surface px-3 py-1.5 text-caption font-medium text-text-secondary'
            }
          >
            {s}
          </button>
        ))}
      </div>
      <SecurePhoneSheet
        key={take}
        initialStep={step}
        api={PRETEND}
        onClose={() => setTake((n) => n + 1)}
      />
    </div>
  );
}

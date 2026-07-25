import { AppIcon, Button, cn } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ONBOARDED_KEY } from './SplashScreen.js';

/**
 * Onboarding.
 *
 * Three panels, and both actions are available on every one of them. Nothing is
 * gated behind swiping to the end — a user who already knows what PINGO is can
 * leave immediately, which is the respectful default.
 *
 * The board shows page dots, so the panels are a carousel; but the copy carries
 * the message and the illustration is the app icon itself. No stock artwork, no
 * feature grid, no permission requests before the user has seen the product.
 */

interface Panel {
  title: string;
  body: string;
}

const PANELS: Panel[] = [
  {
    title: 'Welcome to PINGO',
    body: 'Private messaging, redefined for you.',
  },
  {
    title: 'Calm by design',
    body: 'No noise, no endless feeds. Just the conversations that matter to you.',
  },
  {
    title: 'Yours alone',
    body: 'Your messages stay between you and the people you send them to.',
  },
];

export function OnboardingScreen() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const panel = PANELS[index] ?? PANELS[0]!;
  const isLast = index === PANELS.length - 1;

  const finish = () => {
    localStorage.setItem(ONBOARDED_KEY, 'true');
    navigate('/chats', { replace: true });
  };

  const advance = () => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-brand-wash">
      <div
        className="pointer-events-none absolute -left-32 -top-20 size-[26rem] rounded-full bg-brand/10 blur-3xl"
        aria-hidden
      />

      {/* The card holds everything, so its height never changes as copy changes. */}
      <div className="relative flex flex-1 items-center justify-center px-6 py-10">
        <div
          className={cn(
            'w-full max-w-sm rounded-2xl bg-surface/85 p-8 shadow-lg',
            'backdrop-blur-glass',
            'flex flex-col items-center text-center',
          )}
        >
          <AppIcon size={72} variant="light" />

          {/*
            Fixed minimum height across panels: without it, the buttons would
            shift up and down as the copy length changes between steps.
          */}
          <div className="mt-8 flex min-h-32 flex-col items-center">
            {/* `key` restarts the entrance animation on each panel change. */}
            <h1 key={`t-${index}`} className="text-h1 text-ink animate-rise">
              {panel.title}
            </h1>
            <p
              key={`b-${index}`}
              className="mt-3 max-w-[19rem] text-body text-text-secondary animate-rise"
            >
              {panel.body}
            </p>
          </div>

          <div className="mt-2 flex w-full flex-col gap-3">
            <Button variant="primary" size="lg" block onClick={advance}>
              {isLast ? 'Get Started' : 'Continue'}
            </Button>
            <Button variant="secondary" size="lg" block onClick={finish}>
              Log In
            </Button>
          </div>

          {/* Page dots — tappable, so they are navigation and not just decoration. */}
          <div className="mt-7 flex items-center gap-2" role="tablist" aria-label="Onboarding">
            {PANELS.map((p, i) => (
              <button
                key={p.title}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Step ${i + 1}: ${p.title}`}
                onClick={() => setIndex(i)}
                className={cn(
                  'focus-ring rounded-full transition-all duration-quick ease-standard',
                  // The active dot elongates rather than growing, which keeps the
                  // row's vertical rhythm steady.
                  i === index
                    ? 'h-1.5 w-5 bg-dot'
                    : 'size-1.5 bg-line-strong hover:bg-text-tertiary',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

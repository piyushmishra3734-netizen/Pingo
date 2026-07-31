import { useAuth, type AuthMethodKind } from '@pingo/core';
import { AtIcon, Button, ListGroup, ListRow, PhoneIcon } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';

/**
 * Welcome - [docs/01 § 4](../../../../../docs/01-onboarding-auth.md#4-welcome).
 *
 * A **triage screen**, and § 4.1 is emphatic that it therefore has no gradient
 * button: there is no single thing the user came here to do, so nothing is
 * elevated. Equal weight, honest captions, user decides. Elevating Google would
 * be the obvious move and the wrong one for a product whose thesis is privacy.
 *
 * No carousel and no feature tour, per § 4.2 - a user who taps a method has
 * already decided, and a tour delays them to reassure us rather than them.
 *
 * ## Why the rows are data
 *
 * `METHODS` is the blueprint's list in the blueprint's order; the service says
 * which of them it can actually open. A method the service does not implement is
 * **absent, not present-and-broken** - adding a fourth door is an entry here and
 * an entry in `supportedMethods`, with no change to the rendering below. That is
 * § 20.2's *auth methods are a list, not a type*, made literal.
 *
 * All three doors are open now. Email and phone lead to an identifier screen
 * then a password; Google leaves for the provider and comes back signed in.
 */

interface MethodRow {
  kind: AuthMethodKind;
  label: string;
  /** Only where it says something true and useful - § 4.2. */
  caption?: string;
  icon: ReactNode;
  path: string;
}

const METHODS: MethodRow[] = [
  {
    kind: 'google',
    label: 'Continue with Google',
    caption: 'Fastest, no password',
    icon: <GoogleMark />,
    // Both doors share one interstitial, see `GoogleConnectingScreen`.
    path: '/auth/google',
  },
  {
    kind: 'email',
    label: 'Continue with Email',
    // Deliberately none. § 4.2: "there is nothing to add".
    icon: <AtIcon size={20} />,
    path: '/signup/email',
  },
  {
    kind: 'phone',
    label: 'Continue with Phone',
    caption: 'Helps friends find you',
    // The branding board's own phone glyph, already in `@pingo/ui`. An earlier
    // pass drew a keypad here instead - a second icon for an idea the set had
    // covered, in a family whose whole point is consistency.
    icon: <PhoneIcon size={20} />,
    path: '/signup/phone',
  },
];

export function SignUpMethodScreen() {
  const navigate = useNavigate();
  const { service } = useAuth();

  const available = METHODS.filter((method) => service.supportedMethods.includes(method.kind));
  const showsGoogle = available.some((method) => method.kind === 'google');

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-brand-wash">
      <div
        className="pointer-events-none absolute -left-32 -top-20 size-[26rem] rounded-full bg-brand/10 blur-3xl"
        aria-hidden
      />

      {/* ≥ 35% of the viewport stays empty - § 4.2. `justify-center` is what holds it. */}
      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-10 px-6 py-12">
        <div className="flex flex-col items-center">
          <AppLogo size={64} alt="" />

          {/* Title → words → card → Log In, staggered 60ms (§ 4.2). */}
          <h1 className="mt-8 text-h1 text-ink animate-rise">Welcome to PINGO</h1>

          <p
            className="mt-5 text-h2 leading-relaxed text-text-secondary text-center animate-rise"
            style={{ animationDelay: '60ms' }}
          >
            Private.
            <br />
            Beautiful.
            <br />
            Calm.
          </p>
        </div>

        <div className="animate-rise" style={{ animationDelay: '120ms' }}>
          <ListGroup>
            {available.map((method) => (
              <ListRow
                key={method.kind}
                icon={method.icon}
                label={method.label}
                description={method.caption}
                onClick={() => navigate(method.path)}
              />
            ))}
          </ListGroup>

          {/*
            § 4.3 - stated before the choice rather than discovered in a consent
            dialog. Tied to the row's presence: no Google row, no claim about
            Google.
          */}
          {showsGoogle && (
            <p className="mt-3 px-3 text-caption text-text-tertiary">
              Google shares your name, email and profile photo with PINGO. Nothing else.
            </p>
          )}
        </div>

        <div
          className="flex flex-col items-center gap-1 animate-rise"
          style={{ animationDelay: '180ms' }}
        >
          <p className="text-caption text-text-secondary">Already have an account?</p>
          <Button variant="text" size="lg" onClick={() => navigate('/login')}>
            Log In
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The official Google "G" - § 4.2 notes it is the only third-party mark in the
 * product, and their brand terms require the four-colour original rather than a
 * monochrome redraw in our own icon style.
 */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1Z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.5a13 13 0 0 1-19.4-6.8H4.7v5.7A22 22 0 0 0 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M12 28.3a13 13 0 0 1 0-8.6v-5.7H4.7a22 22 0 0 0 0 20l7.3-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3A21 21 0 0 0 24 2 22 22 0 0 0 4.7 14l7.3 5.7A13 13 0 0 1 24 9.5Z"
      />
    </svg>
  );
}

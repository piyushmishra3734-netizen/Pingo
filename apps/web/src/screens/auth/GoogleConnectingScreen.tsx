import { useAuth } from '@pingo/core';
import { Button, PingoDot } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { writeLastMethod } from '../../features/auth/last-method.js';
import { authErrorMessage } from '../../features/auth/messages.js';

/**
 * Google - [docs/01 § 5.1](../../../../../docs/01-onboarding-auth.md#51-consent).
 *
 * The interstitial from that wireframe: *Connecting to Google*, the three brand
 * dots, and a Cancel that returns to Welcome with nothing created.
 *
 * **One screen serves both legs of the trip.** Tapping the Google row lands here
 * and starts the redirect; Google returns the browser to this same URL, where
 * the session is waiting to be picked up. That is why the effect below branches
 * on what is in the query string rather than on a prop - after a full page
 * navigation there is no React state left to carry.
 *
 * Consent is handed to the provider, never rendered in a webview: § 5.1 is
 * explicit, and Google blocks webview OAuth outright because it is a phishing
 * vector.
 */
export function GoogleConnectingScreen() {
  const navigate = useNavigate();
  const { service, signedIn } = useAuth();
  const [params] = useSearchParams();

  const [error, setError] = useState<string | undefined>();

  // React runs effects twice in development. Without this the redirect fires
  // twice and the second call races the first out of the page.
  const started = useRef(false);

  const providerError = params.get('error');
  // PKCE returns `?code=…`; supabase-js exchanges it because `detectSessionInUrl`
  // is on. Its presence means this is the return leg, not the outbound one.
  const returning = params.has('code') || providerError !== null;

  useEffect(() => {
    if (signedIn) {
      writeLastMethod('google');
      navigate('/chats', { replace: true });
    }
  }, [signedIn, navigate]);

  useEffect(() => {
    if (providerError) {
      /*
       * § 19: "Google consent cancelled → Return to Welcome. Nothing created,
       * nothing said." A user who backed out of a consent screen knows what they
       * did; telling them about it is noise.
       */
      if (providerError === 'access_denied') {
        navigate('/welcome', { replace: true });
        return;
      }
      setError(params.get('error_description') ?? 'Google could not sign you in.');
      return;
    }

    if (returning || started.current) return;
    started.current = true;

    void service.google
      .start(`${window.location.origin}/auth/google`)
      .catch((cause: unknown) => setError(authErrorMessage(cause, 'oauth')));
  }, [providerError, returning, service, navigate, params]);

  return (
    <div className="grid h-full place-items-center bg-brand-wash px-6">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        {error ? (
          <>
            <h1 className="text-h1 text-ink">Couldn't connect</h1>
            <p role="alert" className="mt-3 text-caption text-danger">
              {error}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-h1 text-ink animate-rise">
              Connecting
              <br />
              to Google
            </h1>

            <div className="mt-10">
              <PingoDot state="loading" size={8} label="Connecting" />
            </div>
          </>
        )}

        <div className="mt-12">
          <Button variant="text" size="lg" onClick={() => navigate('/welcome', { replace: true })}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

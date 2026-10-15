import { useChat } from '@pingo/core';
import { useEffect } from 'react';

import { startMediaOutbox } from './media-outbox.js';

/**
 * Sends queued photos and videos for as long as the app is open, whatever
 * screen is showing. Starts as soon as somebody is signed in: not on `ready`,
 * which waits for the live connection and so would hold a queue back on
 * exactly the shaky line it exists for. A send that cannot go yet fails and
 * waits like any other.
 */
export function MediaOutboxRunner() {
  const { service, currentUser } = useChat();
  const signedIn = Boolean(currentUser);
  useEffect(() => (signedIn ? startMediaOutbox(service) : undefined), [service, signedIn]);
  return null;
}

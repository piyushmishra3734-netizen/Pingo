/**
 * Who is signed in, read from the session this device already holds.
 *
 * No network and no wait: auth-js refreshes an expired token before it will
 * answer, and that is a round trip online and the whole retry window offline.
 * For the things that only need to know which account this is (opening the
 * cached list, finding the kept profile) the stored session answers at once.
 * Every request is still authorised by the token on the server, so this never
 * grants anything; it only decides what the interface can paint while it waits.
 */
export function storedUserId(): string | undefined {
  try {
    const raw = localStorage.getItem('pingo.auth.session');
    return raw ? ((JSON.parse(raw) as { user?: { id?: string } }).user?.id ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

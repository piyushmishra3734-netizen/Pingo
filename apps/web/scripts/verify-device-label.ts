/**
 * The name a device gives itself in the devices list.
 *
 * Every branch here is an ordering trap: Edge, Opera and Samsung Internet all
 * claim to be Chrome, and Chrome claims to be Safari. A list where three rows
 * all say "Safari on Windows" is useless for the one thing it exists to do,
 * which is let somebody pick out the device they do not recognise.
 *
 * Run with `pnpm verify:device-label`.
 */
import assert from 'node:assert/strict';

import { deviceLabel } from '../src/features/settings/device-label.js';

// Node 24 ships its own read-only `navigator`, so it has to be redefined
// rather than assigned.
function labelFor(userAgent: string): string {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent },
    configurable: true,
    writable: true,
  });
  return deviceLabel();
}

// Chrome on Windows says "Safari" and "Chrome". It is Chrome.
assert.equal(
  labelFor(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ),
  'Chrome on Windows',
);

// Edge says all three. It is Edge.
assert.equal(
  labelFor(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  ),
  'Edge on Windows',
);

// Samsung Internet, likewise, and it is the browser most PINGO phones will use.
assert.equal(
  labelFor(
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  ),
  'Samsung Internet on Android',
);

// Chrome on iOS is CriOS and must not be read as Safari.
assert.equal(
  labelFor(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1',
  ),
  'Chrome on iPhone',
);

// Real Safari, which is the only one that should end up called Safari.
assert.equal(
  labelFor(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  ),
  'Safari on Mac',
);

// Android is checked before Linux, or every phone would say "Linux".
assert.equal(
  labelFor(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  ),
  'Chrome on Android',
);

// Nothing recognisable is a row, not a crash.
assert.equal(labelFor('curl/8.4.0'), 'Unknown device');
assert.equal(labelFor(''), 'Unknown device');

console.log('device label: ok');

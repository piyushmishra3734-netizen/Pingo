/**
 * The local-first media lifecycle, verified rather than asserted.
 *
 * Two halves, because the contract has two halves:
 *
 *   · the limits and the words the sender is given, which are pure functions
 *     and can be checked here
 *   · the retention rules, which live in the database and are checked *in* the
 *     database, against the real schema, inside a transaction that is rolled
 *     back - see `media-lifecycle.test.sql`
 *
 * The second half is the one that matters. A test that runs against a mock of
 * the schema keeps passing after the schema moves, which is precisely how a
 * renamed column on `conversation_members` broke messaging with every test
 * still green.
 *
 * Run with `pnpm verify:media-lifecycle`.
 */
import { execFileSync } from 'node:child_process';

import { MEDIA_LIMITS, formatLimit, mediaTooLarge } from '../../../packages/core/src/media-limits.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('— what PINGO will carry —');

{
  const under = MEDIA_LIMITS.photo - 1;
  check(mediaTooLarge(under, 'photo') === undefined, 'a photo just under the limit is accepted');
  check(mediaTooLarge(MEDIA_LIMITS.photo, 'photo') === undefined, 'exactly the limit is accepted');

  const over = mediaTooLarge(MEDIA_LIMITS.photo + 1, 'photo');
  check(over !== undefined, 'one byte over is refused');
  check(Boolean(over?.includes(formatLimit('photo'))), `the refusal names the limit (${over ?? ''})`);
  check(Boolean(over?.match(/\d/)), 'and names the size of the file');

  // A video arrives as a document, and documents get the larger ceiling. A
  // limit that refused a two-minute clip would make the feature pointless.
  check(MEDIA_LIMITS.file > MEDIA_LIMITS.photo, 'documents are allowed to be larger than photos');
  check(
    mediaTooLarge(50 * 1024 * 1024, 'file') === undefined,
    'a fifty megabyte video is accepted',
  );
  check(
    mediaTooLarge(200 * 1024 * 1024, 'file') !== undefined,
    'a two hundred megabyte one is not',
  );
}

console.log('\n— the retention rules, against the real database —');

/*
 * The SQL raises on purpose: that is what rolls the transaction back, so the
 * fixtures it writes never survive. Its message is the report, and the CLI
 * hands it back as a failed command - which is why this reads stderr rather
 * than treating a non-zero exit as the answer.
 */
let output = '';
try {
  output = execFileSync(
    'npx',
    ['supabase', 'db', 'query', '--linked', '--file', 'apps/web/scripts/media-lifecycle.test.sql'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true },
  );
} catch (error) {
  const failed = error as { stdout?: string; stderr?: string };
  output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
}

const marker = output.indexOf('MEDIA-LIFECYCLE-RESULT');
if (marker < 0) {
  check(false, 'the database test ran');
  console.log(output.slice(0, 800));
} else {
  const report = output
    .slice(marker)
    .replace(/\\n/g, '\n')
    .split('CONTEXT:')[0]!;

  for (const line of report.split('\n').slice(1)) {
    const said = line.trim();
    if (said.startsWith('PASS') || said.startsWith('INFO')) console.log(said);
    else if (said.startsWith('FAIL')) {
      failures += 1;
      console.log(said);
    }
  }

  const counted = /failures=(\d+)/.exec(report);
  check(counted?.[1] === '0', `the database reported ${counted?.[1] ?? '?'} failures`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

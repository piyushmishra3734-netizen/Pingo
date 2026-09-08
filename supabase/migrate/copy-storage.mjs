/**
 * Copies every stored file from one Supabase project to another.
 *
 * The database move carries `storage.buckets` and nothing else that matters
 * here: bucket rows are configuration, and the 89 MB people actually uploaded
 * lives somewhere a `pg_dump` cannot reach. This walks the source project,
 * downloads each object and uploads it to the target at the same path.
 *
 * ## No dependencies, on purpose
 *
 * The first version imported `@supabase/supabase-js`, which is a dependency of
 * `apps/web` and not of the repository root - and ESM resolves from the
 * importing file's own directory, not the working directory, so it could not be
 * found from `supabase/migrate/` however it was run. The Storage API is plain
 * HTTP with a bearer token, so `fetch` does the whole job and there is nothing
 * to install or hoist.
 *
 * ## Why the path has to be identical
 *
 * PINGO's storage policies are path-based - they match on the owner's id being
 * the first segment of the key. A file that lands one folder over is a file its
 * owner can no longer read, and it fails as "photo no longer available", which
 * is indistinguishable from a file that was never copied at all. So the key is
 * reused verbatim and never reconstructed.
 *
 * ## Running it
 *
 *   node supabase/migrate/copy-storage.mjs --check    # compare only, no writes
 *   node supabase/migrate/copy-storage.mjs            # copy
 *
 * It asks for the two service role keys and does not echo them. Both project
 * URLs are defaulted, so in practice there is nothing to assemble.
 *
 * Safe to run twice. An object already present at the same size is skipped, so
 * a run that dies halfway is resumed by running it again rather than by working
 * out where it stopped.
 */

const CHECK_ONLY = process.argv.includes('--check');

/** Storage lists in pages, and a bucket here has more objects than one page. */
const PAGE = 100;

/*
 * Retried, because this is 152 round trips against a project at its egress cap
 * and one timeout should not cost the whole run. Anything still failing after
 * three attempts is reported and the run continues, so one bad object does not
 * hide the other 151.
 */
const ATTEMPTS = 3;

const DEFAULT_SOURCE = 'https://lppzoqgvshhmxqsvggug.supabase.co';
const DEFAULT_TARGET = 'https://gpijpmepzowwhvgkriqu.supabase.co';

/**
 * Asked for rather than required in the environment.
 *
 * A service role key bypasses every row-level policy in the project, so the
 * fewer places it is written down the better - not a shell history, not the
 * screen. The environment still wins if it is set, for an unattended run.
 */
async function ask(prompt, secret) {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  if (secret) {
    process.stdout.write(prompt);
    rl._writeToOutput = () => {};
    const answer = await new Promise((resolve) => rl.question('', resolve));
    rl.close();
    process.stdout.write('\n');
    return answer.trim();
  }

  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  return answer.trim();
}

const trim = (u) => u.replace(/\/+$/, '');

const SOURCE_URL = trim(process.env['SOURCE_URL'] || (await ask(`Old project URL [${DEFAULT_SOURCE}]: `)) || DEFAULT_SOURCE);
const SOURCE_KEY = process.env['SOURCE_SERVICE_KEY'] || (await ask('Old project service_role key: ', true));
const TARGET_URL = trim(process.env['TARGET_URL'] || (await ask(`New project URL [${DEFAULT_TARGET}]: `)) || DEFAULT_TARGET);
const TARGET_KEY = process.env['TARGET_SERVICE_KEY'] || (await ask('New project service_role key: ', true));

if (!SOURCE_KEY || !TARGET_KEY) {
  console.error('Both service role keys are needed.');
  process.exit(1);
}
if (SOURCE_URL === TARGET_URL) {
  console.error('Both URLs are the same project. Refusing to run.');
  process.exit(1);
}

function api(base, key) {
  return async (path, init = {}) => {
    const headers = { apikey: key, authorization: `Bearer ${key}`, ...(init.headers ?? {}) };
    const response = await fetch(`${base}/storage/v1${path}`, { ...init, headers });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${response.status} ${path} ${detail.slice(0, 180)}`);
    }
    return response;
  };
}

const source = api(SOURCE_URL, SOURCE_KEY);
const target = api(TARGET_URL, TARGET_KEY);

async function retry(what, fn) {
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (cause) {
      last = cause;
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(`${what}: ${last?.message ?? last}`);
}

/** Each segment encoded separately, so the slashes stay slashes. */
const objectPath = (bucket, key) =>
  `/object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;

const listPage = (call, bucket, prefix, offset) =>
  call(`/object/list/${encodeURIComponent(bucket)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
  }).then((r) => r.json());

/**
 * Every object in a bucket, including the ones inside folders.
 *
 * The list endpoint is not recursive and returns a folder as an entry whose
 * `id` is null - the only thing in the response separating a folder from a
 * file. Every path in this project begins with the owner's id, so a copy that
 * misses that distinction copies nothing at all.
 */
async function walk(call, bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await retry(`list ${bucket}/${prefix}`, () => listPage(call, bucket, prefix, offset));
    if (!Array.isArray(page) || page.length === 0) break;

    for (const entry of page) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) found.push(...(await walk(call, bucket, key)));
      else found.push({ key, size: entry.metadata?.size ?? 0, type: entry.metadata?.mimetype });
    }

    if (page.length < PAGE) break;
  }
  return found;
}

/*
 * The first call to each project, so a wrong key fails here with a sentence
 * rather than eighty objects later with a stack trace.
 */
async function bucketsOf(call, which) {
  try {
    return await call('/bucket').then((r) => r.json());
  } catch (cause) {
    console.error(`Could not read the ${which} project's buckets.`);
    console.error(`  ${cause.message}`);
    console.error('"Invalid Compact JWS" or "AccessDenied" means the key is wrong.');
    console.error('It is the service_role key from Settings -> API, not the publishable one.');
    process.exit(1);
  }
}

const buckets = await bucketsOf(source, 'old');
await bucketsOf(target, 'new');

console.log(`\n${buckets.length} bucket(s) on the source.\n`);

let copied = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

for (const bucket of buckets.sort((a, b) => a.name.localeCompare(b.name))) {
  const objects = await walk(source, bucket.name);

  /*
   * The bucket is created with the source's own public flag rather than a
   * default. Getting that backwards on `photos` publishes every chat photo in
   * the app, so a target bucket that disagrees is reported rather than used.
   */
  let there = null;
  try {
    there = await target(`/bucket/${encodeURIComponent(bucket.name)}`).then((r) => r.json());
  } catch {
    there = null;
  }

  if (!there) {
    if (CHECK_ONLY) {
      console.log(`${bucket.name.padEnd(12)} MISSING on target (${objects.length} objects)`);
      continue;
    }
    await target('/bucket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: bucket.id,
        name: bucket.name,
        public: bucket.public,
        file_size_limit: bucket.file_size_limit ?? null,
        allowed_mime_types: bucket.allowed_mime_types ?? null,
      }),
    });
    console.log(`${bucket.name}: created (public=${bucket.public})`);
  } else if (there.public !== bucket.public) {
    console.error(
      `${bucket.name}: PUBLIC FLAG DIFFERS - source ${bucket.public}, target ${there.public}. Fix before trusting this copy.`,
    );
  }

  const have = new Map();
  try {
    for (const object of await walk(target, bucket.name)) have.set(object.key, object.size);
  } catch {
    /* An empty or missing bucket on the target just means nothing to skip. */
  }

  let bucketCopied = 0;
  let bucketSkipped = 0;

  for (const object of objects) {
    if (object.size > 0 && have.get(object.key) === object.size) {
      bucketSkipped += 1;
      skipped += 1;
      continue;
    }
    if (CHECK_ONLY) {
      bucketCopied += 1;
      copied += 1;
      continue;
    }

    try {
      const body = await retry(`download ${bucket.name}/${object.key}`, () =>
        source(objectPath(bucket.name, object.key)).then((r) => r.arrayBuffer()),
      );

      await retry(`upload ${bucket.name}/${object.key}`, () =>
        target(objectPath(bucket.name, object.key), {
          method: 'POST',
          headers: {
            'content-type': object.type || 'application/octet-stream',
            'x-upsert': 'true',
          },
          body,
        }),
      );

      bucketCopied += 1;
      copied += 1;
      bytes += object.size;
    } catch (cause) {
      failed += 1;
      console.error(`  FAILED ${bucket.name}/${object.key} - ${cause.message}`);
    }
  }

  console.log(
    `${bucket.name.padEnd(12)} ${String(objects.length).padStart(4)} objects  ` +
      `${CHECK_ONLY ? 'would copy' : 'copied'} ${bucketCopied}, already there ${bucketSkipped}`,
  );
}

console.log('');
console.log(`${CHECK_ONLY ? 'would copy' : 'copied'}: ${copied}`);
console.log(`already there: ${skipped}`);
if (!CHECK_ONLY) console.log(`bytes moved: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (failed > 0) {
  console.log(`FAILED: ${failed} - run again, it resumes`);
  process.exit(1);
}
console.log('Nothing failed.');

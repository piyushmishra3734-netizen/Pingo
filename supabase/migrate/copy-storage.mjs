/**
 * Copies every stored file from one Supabase project to another.
 *
 * The database move carries `storage.buckets` and nothing else that matters
 * here: bucket rows are configuration, and the 89 MB people actually uploaded
 * lives somewhere a `pg_dump` cannot reach. This walks the source project,
 * downloads each object and uploads it to the target at the same path.
 *
 * ## Why the path has to be identical
 *
 * PINGO's storage policies are path-based - they match on the owner's id being
 * the first segment of the key. A file that lands one folder over is a file its
 * owner can no longer read, and it fails as "photo no longer available", which
 * is indistinguishable from a file that was never copied at all. So the key is
 * reused verbatim and never reconstructed.
 *
 * ## Credentials
 *
 * Four values, all from the environment, none of them written down here:
 *
 *   SOURCE_URL  SOURCE_SERVICE_KEY
 *   TARGET_URL  TARGET_SERVICE_KEY
 *
 * The service role is needed on both sides: the source because six of the eight
 * buckets are private, the target because uploading into somebody else's folder
 * is exactly what the policies are there to prevent.
 *
 * ## Running it
 *
 *   node supabase/migrate/copy-storage.mjs            # copy
 *   node supabase/migrate/copy-storage.mjs --check    # compare only, no writes
 *
 * Safe to run twice. An object already present at the same size is skipped, so
 * a run that dies halfway is resumed by running it again rather than by working
 * out where it stopped.
 */
import { createClient } from '@supabase/supabase-js';

const CHECK_ONLY = process.argv.includes('--check');

/** Storage lists in pages, and a bucket here has more objects than one page. */
const PAGE = 100;

/*
 * Retried, because this is 151 round trips against a project that is at its
 * egress cap and one timeout should not cost the whole run. Three attempts with
 * a growing pause; anything still failing after that is reported and the run
 * continues, so one bad object does not hide the other 150.
 */
const ATTEMPTS = 3;

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Four are needed:`);
    console.error('  SOURCE_URL SOURCE_SERVICE_KEY TARGET_URL TARGET_SERVICE_KEY');
    process.exit(1);
  }
  return value;
}

const source = createClient(need('SOURCE_URL'), need('SOURCE_SERVICE_KEY'), {
  auth: { persistSession: false },
});
const target = createClient(need('TARGET_URL'), need('TARGET_SERVICE_KEY'), {
  auth: { persistSession: false },
});

if (need('SOURCE_URL') === need('TARGET_URL')) {
  console.error('SOURCE_URL and TARGET_URL are the same project. Refusing to run.');
  process.exit(1);
}

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

/**
 * Every object in a bucket, including the ones inside folders.
 *
 * `list` is not recursive and returns folders as entries with no `id`, which is
 * the only thing separating a folder from a file in the response. Missing that
 * distinction is how a copy silently skips every per-user folder - and every
 * path in this project starts with one.
 */
async function walk(bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await retry(`list ${bucket}/${prefix}`, async () => {
      const result = await source.storage.from(bucket).list(prefix, { limit: PAGE, offset });
      if (result.error) throw result.error;
      return result;
    });
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) found.push(...(await walk(bucket, key)));
      else found.push({ key, size: entry.metadata?.size ?? 0, type: entry.metadata?.mimetype });
    }

    if (data.length < PAGE) break;
  }
  return found;
}

/** What the target already has, so a second run does not re-upload 89 MB. */
async function existing(bucket) {
  const seen = new Map();
  const stack = [''];
  while (stack.length > 0) {
    const prefix = stack.pop();
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await target.storage
        .from(bucket)
        .list(prefix, { limit: PAGE, offset });
      // A bucket that is not there yet is not an error worth stopping for.
      if (error) return seen;
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const key = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null || entry.id === undefined) stack.push(key);
        else seen.set(key, entry.metadata?.size ?? 0);
      }
      if (data.length < PAGE) break;
    }
  }
  return seen;
}

const { data: buckets, error: bucketError } = await source.storage.listBuckets();
if (bucketError) {
  console.error('Could not read the source buckets:', bucketError.message);
  process.exit(1);
}

console.log(`${buckets.length} bucket(s) on the source.\n`);

let copied = 0;
let skipped = 0;
let failed = 0;
let missingBuckets = 0;
let bytes = 0;

for (const bucket of buckets.sort((a, b) => a.name.localeCompare(b.name))) {
  const objects = await walk(bucket.name);
  const have = await existing(bucket.name);

  /*
   * The bucket is created rather than assumed, with the source's own public
   * flag. Getting that backwards on `photos` would publish every chat photo in
   * the app, so it is copied from the source rather than defaulted.
   */
  const { data: there } = await target.storage.getBucket(bucket.name);
  if (!there) {
    if (CHECK_ONLY) {
      console.log(`${bucket.name}: MISSING on target (${objects.length} objects to copy)`);
      missingBuckets += 1;
      continue;
    }
    const { error } = await target.storage.createBucket(bucket.name, {
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit ?? undefined,
      allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
    });
    if (error) {
      console.error(`${bucket.name}: could not create - ${error.message}`);
      failed += objects.length;
      continue;
    }
    console.log(`${bucket.name}: created (public=${bucket.public})`);
  } else if (there.public !== bucket.public) {
    console.error(
      `${bucket.name}: PUBLIC FLAG DIFFERS - source ${bucket.public}, target ${there.public}. Fix this before trusting the copy.`,
    );
  }

  let bucketCopied = 0;
  let bucketSkipped = 0;

  for (const object of objects) {
    if (have.get(object.key) === object.size && object.size > 0) {
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
      const blob = await retry(`download ${bucket.name}/${object.key}`, async () => {
        const result = await source.storage.from(bucket.name).download(object.key);
        if (result.error) throw result.error;
        return result.data;
      });

      await retry(`upload ${bucket.name}/${object.key}`, async () => {
        const result = await target.storage.from(bucket.name).upload(object.key, blob, {
          contentType: object.type ?? blob.type ?? 'application/octet-stream',
          upsert: true,
        });
        if (result.error) throw result.error;
        return result;
      });

      bucketCopied += 1;
      copied += 1;
      bytes += object.size;
    } catch (cause) {
      failed += 1;
      console.error(`  FAILED ${bucket.name}/${object.key} - ${cause.message}`);
    }
  }

  const verb = CHECK_ONLY ? 'would copy' : 'copied';
  console.log(
    `${bucket.name.padEnd(12)} ${String(objects.length).padStart(4)} objects  ${verb} ${bucketCopied}, already there ${bucketSkipped}`,
  );
}

console.log('');
console.log(`${CHECK_ONLY ? 'would copy' : 'copied'}: ${copied}`);
console.log(`already there: ${skipped}`);
if (!CHECK_ONLY) console.log(`bytes moved: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (missingBuckets > 0) console.log(`buckets missing on target: ${missingBuckets}`);
if (failed > 0) {
  console.log(`FAILED: ${failed} - run again, it resumes`);
  process.exit(1);
}
console.log('Nothing failed.');

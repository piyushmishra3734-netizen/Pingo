/**
 * The Drive client against a Drive that behaves like Google's.
 *
 * Google is not reachable from here — there is no OAuth client for
 * `drive.appdata` yet and consent cannot be granted on anyone's behalf — so
 * this stands in a server implementing the same protocol: resumable sessions,
 * `308` with a `Range` header, `401` on a dead token, `404` on a deleted file.
 *
 * That boundary is worth being precise about. Everything below is measured;
 * whether Google's own responses match this contract is not, and remains an
 * integration test to run once the Cloud project exists.
 *
 * Run with `pnpm verify:drive`.
 */
import { DriveClient, DriveError, UPLOAD_CHUNK } from '../src/lib/backup/drive/client.js';
import { DriveAuthError } from '../src/lib/backup/drive/auth.js';
import { FakeAuth, FakeDrive } from './fake-drive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const payload = new Uint8Array(3 * UPLOAD_CHUNK + 1234);
for (let i = 0; i < payload.length; i += 1) payload[i] = i & 0xff;

console.log('— first backup —');

const drive = new FakeDrive();
const auth = new FakeAuth();
const client = new DriveClient(auth, drive.http);

const uploaded = await client.upload('pingo-archive.g1.bin', payload);
check(Boolean(uploaded.id), 'upload returns a file id');
check(drive.files.size === 1, 'exactly one file in appDataFolder');
const stored = [...drive.files.values()][0]!;
check(stored.bytes.length === payload.length, `all ${payload.length} bytes arrived`);
check(Buffer.compare(Buffer.from(stored.bytes), Buffer.from(payload)) === 0, 'bytes are unchanged');

console.log('\n— chunked, not one shot —');

/*
 * 3.001 chunks of payload must have crossed the wire as several PUTs. A single
 * request would mean UPLOAD_CHUNK is not being honoured, which is how a phone
 * on a bad connection ends up retrying megabytes.
 */
check(drive.requests >= 4, `sent in ${drive.requests} requests, not one`);

console.log('\n— restore —');

const found = await client.find('pingo-archive.g1.bin');
check(found?.id === stored.id, 'the archive is findable by name');
const downloaded = await client.download(found!.id);
check(
  Buffer.compare(Buffer.from(downloaded), Buffer.from(payload)) === 0,
  'download returns exactly what was uploaded',
);

console.log('\n— interrupted upload resumes —');

const resumeDrive = new FakeDrive();
const resumeClient = new DriveClient(new FakeAuth(), resumeDrive.http);
const session = await resumeClient.beginUpload('pingo-archive.g2.bin', payload.length);

// The connection dies partway through the first chunk.
resumeDrive.cutAfter = 100_000;
const finished = await resumeClient.transfer(session, payload);

check(Boolean(finished.id), 'the upload completes despite the interruption');
const resumed = [...resumeDrive.files.values()][0]!;
check(resumed.bytes.length === payload.length, 'every byte is present after resuming');
check(
  Buffer.compare(Buffer.from(resumed.bytes), Buffer.from(payload)) === 0,
  'and the resumed file is byte-identical',
);

console.log('\n— resuming asks what Drive already has —');

const partialDrive = new FakeDrive();
const partialClient = new DriveClient(new FakeAuth(), partialDrive.http);
const partialSession = await partialClient.beginUpload('resume-me.bin', payload.length);
partialDrive.sessions.get(partialSession)!.received = payload.subarray(0, UPLOAD_CHUNK);
const already = await partialClient.uploadedSoFar(partialSession, payload.length);
check(already === UPLOAD_CHUNK, `resumes from byte ${already}, not from zero`);

console.log('\n— expired token —');

const expiring = new FakeDrive();
const expiringAuth = new FakeAuth();
const expiringClient = new DriveClient(expiringAuth, expiring.http);
await expiringClient.upload('warm.bin', new Uint8Array(16));

// Google rotates the token; the cached one is now rejected.
expiring.validToken = 'rotated-token';
expiringAuth.token = { accessToken: 'rotated-token', expiresAt: Date.now() + 3_600_000 };
const before = expiringAuth.silentCalls;
const afterRotation = await expiringClient.upload('after-rotation.bin', new Uint8Array(16));
check(Boolean(afterRotation.id), 'a rotated token is refreshed and the upload succeeds');
check(expiringAuth.silentCalls > before, 'the refresh actually happened');

console.log('\n— token that cannot be refreshed —');

const deadAuth = new FakeAuth();
deadAuth.canRefresh = false;
const deadClient = new DriveClient(deadAuth, new FakeDrive().http);
let expired = false;
try {
  await deadClient.upload('nope.bin', new Uint8Array(16));
} catch (cause) {
  expired = cause instanceof DriveAuthError && cause.code === 'expired';
}
check(expired, 'the web case reports expired rather than failing mid-upload');

console.log('\n— disconnect —');

const dropDrive = new FakeDrive();
const dropAuth = new FakeAuth();
const dropClient = new DriveClient(dropAuth, dropDrive.http);
const doomed = await dropClient.upload('bye.bin', new Uint8Array(32));
await dropClient.remove(doomed.id);
check(dropDrive.files.size === 0, 'the blob is removed from Drive');
await dropClient.remove(doomed.id);
check(true, 'removing it twice is not an error');

await dropAuth.disconnect();
let refused = false;
try {
  await dropClient.upload('after-disconnect.bin', new Uint8Array(16));
} catch (cause) {
  refused = cause instanceof DriveAuthError;
}
check(refused, 'after disconnecting, Drive cannot be written to');

console.log('\n— missing file —');

const gone = new DriveClient(new FakeAuth(), new FakeDrive().http);
let notFound = false;
try {
  await gone.download('file-does-not-exist');
} catch (cause) {
  notFound = cause instanceof DriveError && cause.code === 'not-found';
}
check(notFound, 'a deleted backup reports not-found rather than returning nothing');

console.log('\n— the default transport is callable —');

/*
 * `http: Http = fetch` detaches fetch from its global, and every call then
 * throws "Illegal invocation". Every other check in this file injects a
 * transport, so the default shipped unexercised and failed on the very first
 * real backup. This calls the real default: any failure is acceptable except
 * that one, which would mean the binding is gone again.
 */
const defaultTransport = new DriveClient(new FakeAuth());
let illegalInvocation = false;
try {
  await defaultTransport.find('anything');
} catch (cause) {
  illegalInvocation = /illegal invocation/i.test(String((cause as Error)?.message ?? ''));
}
check(!illegalInvocation, 'the default fetch is bound, not passed bare');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

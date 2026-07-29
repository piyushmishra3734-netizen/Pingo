import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

/**
 * Ships an Android build to GitHub Releases.
 *
 * ## Why this is a script and not a paragraph in a document
 *
 * The release path has four steps that must happen in order and one that is
 * easy to skip — building the web bundle before syncing it, so the APK does not
 * quietly ship yesterday's JavaScript. A script cannot forget; a runbook can.
 *
 * ## GitHub, not the website
 *
 * Cloudflare Pages caps a file at 25 MiB. The APK has already come close once,
 * and the moment a build carries the camera models or a native library it stops
 * fitting — a distribution channel with a ceiling that low fails silently at
 * the worst possible time. GitHub Releases allows 2 GB and keeps every version.
 *
 * Pages hosts the website. That is all it does now.
 *
 * Usage:  node scripts/release-android.mjs v1.0.1
 */

const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const REPO = 'piyushmishra3734-netizen/Pingo';

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('usage: node scripts/release-android.mjs v1.2.3');
  process.exit(1);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });

const apk = 'android/app/build/outputs/apk/release/app-release.apk';
/*
 * A stable filename, deliberately.
 *
 * The website links to /releases/latest/download/PINGO.apk. Naming the asset
 * after its version would change that path every release and break the link at
 * the moment it matters, which looks like the download vanishing rather than
 * like a rename. The tag carries the version; the filename does not need to.
 */
const asset = `.tools/release/PINGO.apk`;

/*
 * The env has to reach Gradle, and the JDK is the portable one in `.tools`
 * rather than anything installed system-wide. Both are set here so the script
 * works from a shell that knows nothing about either.
 */
const env = {
  ...process.env,
  JAVA_HOME: 'E:/Pingo chat/.tools/jdk-21.0.11+10',
  GRADLE_USER_HOME: 'E:/Pingo chat/.tools/gradle-home',
  TMP: 'E:/pingo-build-tmp',
  TEMP: 'E:/pingo-build-tmp',
};

console.log(`\n▸ building the web bundle`);
run('pnpm', ['--filter', '@pingo/web', 'build'], { cwd: '../..', shell: true });

console.log(`\n▸ syncing into Android`);
run('npx', ['cap', 'sync', 'android'], { shell: true });
run('node', ['scripts/trim-android-assets.mjs']);

console.log(`\n▸ building the signed release APK`);
/*
 * `gradlew.bat` on Windows, `./gradlew` everywhere else.
 *
 * `shell: true` spawns cmd.exe on Windows, and cmd does not understand a `./`
 * prefix — it reports "'.' is not recognized as an internal or external
 * command", which reads like a missing tool rather than a path syntax the
 * shell cannot parse.
 */
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradlew, ['assembleRelease', '--no-daemon'], { cwd: 'android', env, shell: true });

if (!existsSync(apk)) {
  console.error(`no APK at ${apk} — the Gradle build did not produce one`);
  process.exit(1);
}

mkdirSync('.tools/release', { recursive: true });
copyFileSync(apk, asset);

const size = (readFileSync(asset).length / 1048576).toFixed(2);
console.log(`\n▸ publishing ${tag} (${size} MB)`);

/*
 * `--latest` is what makes the website's link keep working. It points at
 * `/releases/latest/download/`, so publishing marks this build current and the
 * download page needs no edit.
 */
run(GH, [
  'release',
  'create',
  tag,
  `${asset}#PINGO.apk`,
  '--repo',
  REPO,
  '--title',
  `PINGO ${tag} — Android`,
  '--generate-notes',
  '--latest',
]);

console.log(`\n✓ https://github.com/${REPO}/releases/tag/${tag}`);

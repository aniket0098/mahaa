/**
 * Build a small, REAL, playable MP4, for device verification.
 *
 * A file that merely starts with an `ftyp` box passes the server's magic-byte
 * sniff but never decodes, so it would prove the sniff and nothing about
 * playback. A genuinely decodable H.264 movie is needed, and the honest way to
 * get one without shipping a binary asset is `adb screenrecord`: the phone's
 * own hardware encoder produces a container the phone's own decoder consumes.
 *
 *   node tools/make-device-video.mjs [serial] [seconds]
 *
 * Moves the home screen for a couple of seconds while recording so the frames
 * are not identical, then pulls the clip to `.e2e-media/clip-device.mp4` and
 * prints the size. The seed script later uploads it through the real API.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

mkdirSync('C:/mahaa/.e2e-media', { recursive: true });

const ADB =
  'C:\\Users\\danik\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';
const serial = process.argv[2] ?? 'a1cf1e3e';
const seconds = Math.max(2, Math.min(10, Number(process.argv[3] ?? 4)));
const REMOTE = '/sdcard/_verify_clip.mp4';
const OUT = 'C:/mahaa/.e2e-media/clip-device.mp4';

const adb = (...args) =>
  execFileSync(ADB, ['-s', serial, ...args], { stdio: 'inherit' });

// No `input keyevent` anywhere: a locked or hardened build refuses injected
// input outright, but `am start` needs no injection and works unlocked too.
adb('shell', 'am', 'start', '-n', 'com.mahajob.mobile/.MainActivity');
await new Promise((r) => setTimeout(r, 2500));

process.stdout.write(`recording ${seconds}s of the phone screen to ${REMOTE}\n`);
execFileSync(
  ADB,
  ['-s', serial, 'shell', `screenrecord --time-limit ${seconds} --size 480x854 ${REMOTE}`],
  { stdio: 'inherit' },
);
adb('pull', REMOTE, OUT);

const { size } = await import('node:fs').then((fs) =>
  fs.promises.stat('C:\\mahaa\\.e2e-media\\clip-device.mp4'),
);
if (!existsSync('C:\\mahaa\\.e2e-media\\clip-device.mp4') || size < 10_000) {
  process.stdout.write(`FAIL clip missing or implausibly small (${size} bytes)\n`);
  process.exit(1);
}
process.stdout.write(`PASS device clip pulled: ${size} bytes -> ${OUT}\n`);

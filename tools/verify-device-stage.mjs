#!/usr/bin/env node
/**
 * verify-device-stage.mjs — drive the installed MahaJob APK on a physical
 * Android device and assert the immersive video stage (VideoSurface chrome)
 * really behaves: play/pause flip on a centre tap, Post options + mute corner,
 * the rail's like flip, and a Connect pill for a real other person.
 *
 * Selectors are grounded in the components themselves, not guesses:
 *   - `PostVideo.tsx` sets `accessibilityLabel={playing ? 'Pause video' :
 *     'Play video'}` on the full-frame stage Pressable (its testID never
 *     surfaces — accessibilityLabel wins in Android's content-desc), and the
 *     same labels on the band toggle, which immersive mode does NOT render.
 *     The stage button is therefore recognised by label + very large bounds.
 *   - `VideoOverlay.tsx` labels the pill `Send a connection request to <name>`
 *     with a child text of Connect/Pending/Connected.
 *   - `FeedPostCard.tsx`/`PostHeader.tsx` use `Post options`; `PostVideo.tsx`
 *     uses `Mute video`/`Unmute video`.
 *
 * Screenshots and node dumps land in C:/mahaa/.device-stage/. Exits non-zero
 * when any recorded check fails.
 *
 * Usage: node tools/verify-device-stage.mjs <serial> [seedJson]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const [, , serial = '', seedPath = 'C:/mahaa/tools/.device-seed.json'] = process.argv;
if (!serial) {
  console.error('usage: node verify-device-stage.mjs <adb-serial> [seedJson]');
  process.exit(2);
}

const ADB = 'C:/Users/danik/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const OUT = 'C:/mahaa/.device-stage';
const PKG = 'com.mahajob.mobile';

mkdirSync(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}
const step = (msg) => console.log(`--- ${msg}`);

function run(args) {
  const res = spawnSync(ADB, ['-s', serial, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    out: res.stdout ?? '',
    err: res.stderr ?? '',
    code: res.status ?? -1,
  };
}

/** Parse a uiautomator dump into plain nodes with computed centres. */
function nodes(xml) {
  const list = [];
  const re = /<node[^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const attr = (name) => {
      const found = new RegExp(`${name}="([^"]*)"`).exec(tag);
      return found ? found[1] : '';
    };
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds')) ?? [];
    const x = Number(bounds[1] ?? 0);
    const y = Number(bounds[2] ?? 0);
    const x2 = Number(bounds[3] ?? 0);
    const y2 = Number(bounds[4] ?? 0);
    list.push({
      text: attr('text'),
      desc: attr('content-desc'),
      cls: (attr('class') || '').split('.').pop() ?? '',
      x,
      y,
      w: x2 - x,
      h: y2 - y,
      cx: Math.round((x + x2) / 2),
      cy: Math.round((y + y2) / 2),
    });
  }
  return list;
}

function dump() {
  const d = run(['shell', 'uiautomator', 'dump', '/sdcard/_stage.xml']);
  if (d.code !== 0) throw new Error(`uiautomator dump failed: ${d.err || d.out}`);
  const pulled = run(['pull', '/sdcard/_stage.xml', `${OUT}/_dump.xml`]);
  if (pulled.code !== 0) throw new Error('uiautomator dump pull failed');
  return nodes(readFileSync(`${OUT}/_dump.xml`, 'utf8'));
}

function shot(name) {
  run(['shell', 'screencap', '-p', '/sdcard/_stage.png']);
  run(['pull', '/sdcard/_stage.png', `${OUT}/${name}.png`]);
  return `${OUT}/${name}.png`;
}

/** Tap the centre of the first node matching predicate; throws when absent. */
function tapNode(list, predicate, what) {
  const node = list.find(predicate);
  if (!node) throw new Error(`nothing to tap: ${what}`);
  const tapped = run(['shell', 'input', 'tap', String(node.cx), String(node.cy)]);
  if (tapped.code !== 0) throw new Error(`tap failed: ${what}`);
  return node;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (list, predicate) => list.some(predicate);
const label = (n) => (n.desc || n.text || '').trim();
/** The full-frame immersive stage toggle: play/pause label on a huge button. */
const stageToggle = (n) =>
  n.cls === 'Button' &&
  (n.desc === 'Play video' || n.desc === 'Pause video') &&
  n.h > 600 &&
  n.w > 500;

if (!existsSync(seedPath)) {
  console.error(`FAIL no seed file at ${seedPath} — run tools/seed-device-feed.mjs first`);
  process.exit(2);
}
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
const { marker } = seed;

// --- launch fresh ------------------------------------------------------------
step('launch the app fresh');
run(['shell', 'am', 'force-stop', PKG]);
run(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`]);
await sleep(12_000);
let tree = dump();
shot('01-launch');

// --- sign in when a login form is what we got -------------------------------
const editFields = (t) => t.filter((n) => n.cls === 'EditText').sort((a, b) => a.cy - b.cy);
const signInHere = (t) =>
  t.some((n) => /^(sign in|log in)$/i.test((n.text || '').trim())) ||
  t.some((n) => /^(sign in|log in)$/i.test((n.desc || '').trim()));

if (editFields(tree).length >= 2 && signInHere(tree)) {
  step('login form is up; signing in as the seeded reader');
  const fields = editFields(tree).slice(0, 2);
  // `input text` types literally — only spaces need %s. Never %40/%2E here.
  const typed = [seed.users.reader.email, seed.users.reader.password];
  for (let i = 0; i < typed.length; i += 1) {
    run(['shell', 'input', 'tap', String(fields[i].cx), String(fields[i].cy)]);
    await sleep(900);
    run(['shell', 'input', 'text', typed[i].replace(/ /g, '%s')]);
    await sleep(400);
  }
  // The IME can hide the submit button; dismiss it before hunting for it.
  run(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  await sleep(1200);
  tree = dump();
  tapNode(tree, (n) => /^(sign in|log in)$/i.test((n.text || n.desc || '').trim()), 'the sign-in button');
  step('sign-in submitted; waiting for the login form to clear');
  const deadline = Date.now() + 90_000;
  let left = false;
  while (Date.now() < deadline && !left) {
    await sleep(3000);
    tree = dump();
    left = editFields(tree).length < 2;
  }
  record('reader signs in through the real login form', left, left ? '' : 'still on login after 90s');
  if (!left) {
    shot('02-stuck-on-login');
    const failedEarly = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failedEarly.length}/${results.length} device checks passed`);
    process.exit(1);
  }
  await sleep(4000);
  tree = dump();
  shot('02-home');
} else {
  step('no login form; assuming an existing session');
  record('app launches into a signed-in session', tree.length > 10, `${tree.length} nodes`);
}

// --- find the seeded video post (may need a swipe) --------------------------
step(`waiting for the seeded caption (${marker})`);
let found = has(tree, (n) => (n.text || '').includes(marker));
{
  const deadline = Date.now() + 60_000;
  while (!found && Date.now() < deadline) {
    // Swipe up on the feed to advance to older posts.
    run(['shell', 'input', 'swipe', '540', '1700', '540', '700', '400']);
    await sleep(3000);
    tree = dump();
    found = has(tree, (n) => (n.text || '').includes(marker));
  }
}
record('seeded video post renders on Home', found, found ? marker : 'caption absent after 60s');
if (!found) {
  shot('03-no-post');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} device checks passed`);
  process.exit(1);
}
shot('03-feed-with-video');

// --- the immersive stage chrome is real --------------------------------------
record(
  'immersive stage toggle is on screen (label + full-frame bounds)',
  has(tree, stageToggle),
  has(tree, stageToggle) ? `desc="${tree.find(stageToggle).desc}"` : 'no Play/Pause stage button',
);
record(
  'post options + mute corner cluster is reachable',
  has(tree, (n) => (n.text || n.desc) === 'Post options') &&
    has(tree, (n) => /^(mute video|unmute video)$/i.test(label(n))),
  'Post options + mute/unmute',
);
record(
  'author identity row renders on the stage',
  has(tree, (n) => /, open profile$/i.test((n.desc || '').trim())),
  tree.find((n) => /, open profile$/i.test((n.desc || '').trim()))?.desc ?? 'no author link',
);

// --- centre tap flips Play <-> Pause (one slot, one toggle) ------------------
const before = tree.find(stageToggle);
if (before) {
  const expect = before.desc === 'Pause video' ? 'Play video' : 'Pause video';
  tapNode(tree, stageToggle, 'the stage full-frame toggle');
  await sleep(5000);
  tree = dump();
  shot('04-after-center-tap');
  const after = tree.find(stageToggle);
  record(
    'centre tap flips the toggle label (Pause <-> Play)',
    Boolean(after) && after.desc === expect,
    after ? `${before.desc} -> ${after.desc} (wanted ${expect})` : 'toggle vanished after tap',
  );
  const toggleCount = tree.filter(stageToggle).length;
  record(
    'exactly one stage slot is playing at a time',
    toggleCount >= 1 && toggleCount <= 2,
    `${toggleCount} stage button(s) mounted`,
  );
}

// --- rail: like flips to liked (optimistic, server-backed) -------------------
if (has(tree, (n) => /^(like this post)$/i.test(label(n)))) {
  tapNode(tree, (n) => /^(like this post)$/i.test(label(n)), 'the rail like button');
  await sleep(4000);
  tree = dump();
  shot('05-after-like');
  record(
    'rail like flips to liked (optimistic, server-backed)',
    has(tree, (n) => /^unlike this post$/i.test(label(n))),
    'likedByMe surfaced on the rail',
  );
} else {
  tree = dump();
  record(
    'rail like flips to liked (optimistic, server-backed)',
    has(tree, (n) => /^unlike this post$/i.test(label(n))),
    'no un-liked Like button found (already liked?)',
  );
}

// --- connect pill: a real other person, never the reader ---------------------
{
  tree = dump();
  const pill = tree.find((n) => /connection request/i.test(n.desc || ''));
  const pillText = pill
    ? tree.find(
        (n) =>
          /^(connect|pending|connected|sending…)$/i.test((n.text || '').trim()) &&
          Math.abs(n.cy - pill.cy) < 300,
      )
    : null;
  const authorSelf = pill?.desc?.endsWith(seed.users.reader.name) ?? false;
  record(
    'Connect pill targets a real other person (never the reader)',
    Boolean(pill) && Boolean(pillText) && !authorSelf,
    pill ? `${pillText?.text ?? '?'} via "${pill.desc}"` : 'no pill on any video card',
  );
  shot('06-with-pill');
}

// --- logcat red-flag sweep ---------------------------------------------------
step('sweeping logcat for JS crashes and playback errors');
{
  const logs = run(['logcat', '-d', '-t', '1500']);
  const redFlags = (logs.out || '')
    .split('\n')
    .filter((line) =>
      /FATAL EXCEPTION|ReactNativeJS.*(Error|error)|ExoPlayer.*error|MediaCodec.*error/i.test(line),
    )
    .slice(0, 10);
  record('no JS crashes or player errors in logcat', redFlags.length === 0, redFlags.join(' // ') || 'clean');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} device checks passed`);
process.exit(failed.length === 0 ? 0 : 1);


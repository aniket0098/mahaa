/**
 * Inject a touch at (x, y) in SCREEN pixels via raw kernel events.
 *
 *   node tools/adb-tap.mjs <x> <y> [serial] [holdMs]
 *
 * Why this exists: on this Xiaomi/HyperOS Android 16 device the `adb shell
 * input tap` path throws `SecurityException: ... INJECT_EVENTS permission`
 * even though com.android.shell has the permission granted — MIUI gates
 * injection behind its "USB debugging (Security settings)" property
 * (`persist.security.adbinput`), which shell cannot set (SELinux denies
 * setprop). `sendevent` writes to /dev/input/eventX directly: shell is in
 * the `input` group, no InputManagerService check runs, no app-op runs.
 *
 * Geometry (from `getevent -p`, device `fts_ts`, INPUT_PROP_DIRECT):
 *   ABS_MT_POSITION_X (53): 0..17279 maps 1:1 across 1080 px (portrait)
 *   ABS_MT_POSITION_Y (54): 0..38271 maps 1:1 across 2400 px
 *   BTN_TOUCH (330) down/up, ABS_MT_TRACKING_ID (57), SYN_REPORT (0,0,0)
 * Type-B MT protocol, slot 0.
 */
import { execFileSync } from 'node:child_process';

const ADB =
  'C:\\\\Users\\danik\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';
const DEV = '/dev/input/event6';
const X_MAX = 17279;
const Y_MAX = 38271;
const SCREEN_W = 1080;
const SCREEN_H = 2400;

const x = Number(process.argv[2]);
const y = Number(process.argv[3]);
const serial = process.argv[4] ?? 'a1cf1e3e';
const holdMs = Number(process.argv[5] ?? 60);
if (!Number.isFinite(x) || !Number.isFinite(y)) {
  process.stderr.write('usage: node tools/adb-tap.mjs <x> <y> [serial] [holdMs]\n');
  process.exit(2);
}

const rx = Math.round((x * X_MAX) / (SCREEN_W - 1));
const ry = Math.round((y * Y_MAX) / (SCREEN_H - 1));

const ev = (...a) =>
  execFileSync(ADB, ['-s', serial, 'shell', 'sendevent', DEV, ...a.map(String)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

// Down: slot 0, tracking id 1, position, BTN_TOUCH press.
ev(1, 47, 0); // EV_ABS ABS_MT_SLOT 0
ev(1, 57, 1); // EV_ABS ABS_MT_TRACKING_ID 1
ev(1, 53, rx); // EV_ABS ABS_MT_POSITION_X
ev(1, 54, ry); // EV_ABS ABS_MT_POSITION_Y
ev(1, 330, 1); // EV_KEY BTN_TOUCH down
ev(0, 0, 0); // EV_SYN SYN_REPORT
await new Promise((r) => setTimeout(r, holdMs));
// Up: release tracking id and BTN_TOUCH.
ev(1, 47, 0); // EV_ABS ABS_MT_SLOT 0
ev(1, 57, 4294967295); // EV_ABS ABS_MT_TRACKING_ID -1 (u32)
ev(1, 330, 0); // EV_KEY BTN_TOUCH up
ev(0, 0, 0); // EV_SYN SYN_REPORT

process.stdout.write(`tap (${x},${y}) -> raw (${rx},${ry}) on ${DEV}\n`);

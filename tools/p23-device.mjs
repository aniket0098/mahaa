#!/usr/bin/env node
/**
 * Phase 23 device driver.
 *
 * Drives the running dev-client build on the emulator for the physical-device
 * acceptance flows: dump the view hierarchy, tap a node by its text or
 * accessibility label, type into the focused field, and print what is on
 * screen. Read-only against the backend apart from the actions a human would
 * perform in the same order.
 *
 *   node tools/p23-device.mjs dump
 *   node tools/p23-device.mjs tap --text "I already have an account"
 *   node tools/p23-device.mjs type --text "hello"
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ADB =
  process.env.ADB_PATH ??
  `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`;
const SERIAL = process.env.ANDROID_SERIAL ?? 'emulator-5554';

const adb = (args) =>
  execFileSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8' });

/** Pull the current view hierarchy and hand back the raw XML. */
function dump() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/_p23_dump.xml']);
  return adb(['shell', 'cat', '/sdcard/_p23_dump.xml']);
}

/** Every node's text/label, deduplicated, in screen order. */
function texts(xml) {
  const out = [];
  const re = /(?:text|content-desc)="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) {
    const value = m[1]
      .replace(/&#10;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (value.length > 1 && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Centre point of the best node matching `needle`. */
function findCentre(xml, needle) {
  const nodeRe = /<node\b[^>]*>/g;
  let m;
  const candidates = [];
  while ((m = nodeRe.exec(xml))) {
    const tag = m[0];
    const text = /text="([^"]*)"/.exec(tag);
    const desc = /content-desc="([^"]*)"/.exec(tag);
    const haystack = `${text?.[1] ?? ''} ${desc?.[1] ?? ''}`
      .replace(/&#10;/g, ' ')
      .trim();
    if (!haystack.includes(needle)) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (!bounds) continue;
    const [, x1, y1, x2, y2] = bounds.map(Number);
    // A zero-height node is a container, not something a person can tap.
    if (y2 - y1 < 4 || x2 - x1 < 4) continue;
    const clickable = /clickable="true"/.test(tag);
    const exact = haystack === needle;
    candidates.push({
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      // An exact, clickable match wins; then clickable; then exact; then order.
      score: (exact ? 2 : 0) + (clickable ? 4 : 0),
      area: (x2 - x1) * (y2 - y1),
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.area - b.area);
  const best = candidates[0];
  return { x: best.x, y: best.y };
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : null;
};

if (command === 'dump') {
  const xml = dump();
  console.log(texts(xml).join('\n'));
} else if (command === 'tap') {
  const needle = flag('text');
  const xml = dump();
  const centre = findCentre(xml, needle);
  if (!centre) {
    console.error(`NOT FOUND: ${needle}`);
    console.error(texts(xml).join('\n'));
    process.exit(2);
  }
  adb(['shell', 'input', 'tap', String(centre.x), String(centre.y)]);
  console.log(`tapped ${needle} at ${centre.x},${centre.y}`);
} else if (command === 'type') {
  const value = flag('text');
  adb(['shell', 'input', 'text', value.replace(/ /g, '%s')]);
  console.log(`typed ${value.length} chars`);
} else if (command === 'shot') {
  const dir = mkdtempSync(join(tmpdir(), 'p23-'));
  const png = join(dir, 'screen.png');
  try {
    execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    require('node:fs').writeFileSync(png, '');
  } catch {
    /* exec-out streams; the helper writes the file directly below */
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('use exec-out screencap directly for PNG capture');
} else {
  console.error('usage: dump | tap --text X | type --text X');
  process.exit(1);
}

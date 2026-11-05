#!/usr/bin/env node
/**
 * Phase 24 device helper.
 *
 * Thin wrapper over adb that drives the running dev-client build on the
 * connected physical device. Unlike p23-device.mjs (which defaulted to the
 * emulator) this reads ANDROID_SERIAL or falls back to the currently attached
 * physical device, and adds `shot` (PNG to a file) plus `metar`/tap/type/dump.
 *
 *   node tools/p24-device.mjs dump              # print visible text/labels
 *   node tools/p24-device.mjs tap --text X      # tap best node matching X
 *   node tools/p24-device.mjs type --text X     # type into focused field
 *   node tools/p24-device.mjs shot [file.png]   # screencap to a file
 *   node tools/p24-device.mjs keycode 4         # raw keyevent (4 = BACK)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SDK = `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`;

function firstSerial() {
  const out = execFileSync(SDK, ['devices'], { encoding: 'utf8' });
  const lines = out.split(/\r?\n/).slice(1).filter((l) => l.trim() && !l.includes('List of'));
  if (!lines.length) {
    console.error('NO DEVICE ATTACHED');
    process.exit(3);
  }
  return lines[0].split(/\s+/)[0];
}

const SERIAL = process.env.ANDROID_SERIAL ?? firstSerial();
const adb = (args, opts = {}) =>
  execFileSync(SDK, ['-s', SERIAL, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

function dumpXml() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/_p24_dump.xml']);
  return adb(['shell', 'cat', '/sdcard/_p24_dump.xml']);
}

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

function findCentre(xml, needle) {
  const nodeRe = /<node\b[^>]*>/g;
  let m;
  const candidates = [];
  while ((m = nodeRe.exec(xml))) {
    const tag = m[0];
    const text = /text="([^"]*)"/.exec(tag);
    const desc = /content-desc="([^"]*)"/.exec(tag);
    const haystack = `${text?.[1] ?? ''} ${desc?.[1] ?? ''}`.replace(/&#10;/g, ' ').trim();
    if (!haystack.includes(needle)) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (!bounds) continue;
    const [, x1, y1, x2, y2] = bounds.map(Number);
    if (y2 - y1 < 4 || x2 - x1 < 4) continue;
    const clickable = /clickable="true"/.test(tag);
    const exact = haystack === needle;
    candidates.push({
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      score: (exact ? 2 : 0) + (clickable ? 4 : 0),
      area: (x2 - x1) * (y2 - y1),
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.area - b.area);
  return { x: candidates[0].x, y: candidates[0].y };
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : null;
};

if (command === 'dump') {
  console.log(texts(dumpXml()).join('\n'));
} else if (command === 'tap') {
  const needle = flag('text');
  const xml = dumpXml();
  const centre = findCentre(xml, needle);
  if (!centre) {
    console.error(`NOT FOUND: ${needle}`);
    console.error(texts(xml).join('\n'));
    process.exit(2);
  }
  adb(['shell', 'input', 'tap', String(centre.x), String(centre.y)]);
  console.log(`tapped "${needle}" at ${centre.x},${centre.y}`);
} else if (command === 'type') {
  const value = flag('text');
  adb(['shell', 'input', 'text', value.replace(/ /g, '%s')]);
  console.log(`typed ${value.length} chars`);
} else if (command === 'keycode') {
  adb(['shell', 'input', 'keyevent', rest[0]]);
  console.log(`keyevent ${rest[0]}`);
} else if (command === 'shot') {
  const file = flag('out') ?? rest[0] ?? 'p24_shot.png';
  const png = execFileSync(SDK, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(file, png);
  console.log(`saved ${file} (${png.length} bytes)`);
} else {
  console.error('usage: dump | tap --text X | type --text X | keycode N | shot [out.png]');
  process.exit(1);
}

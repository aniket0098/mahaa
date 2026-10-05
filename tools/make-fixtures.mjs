/**
 * Build the media fixtures the UI run needs: a real PNG, a real playable MP4,
 * and deliberately invalid files for the error tests.
 *
 * **Both real files are produced, not stubbed.** The PNG is encoded here with
 * `zlib`. The MP4 cannot be hand-written — a file that merely starts with an
 * `ftyp` box passes the server's magic-byte sniff but will not decode, so it
 * would prove the *sniff* and nothing about playback. It is therefore recorded
 * by the browser that has to play it: a canvas is animated, captured through
 * `captureStream`, and encoded with `MediaRecorder`. What comes out is a
 * genuine H.264 MP4 that the very same browser will later render.
 *
 * That makes the video test honest in a way a fixture could not be.
 */

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { connect, openPage } from './cdp.mjs';

const OUT = process.argv[2] ?? 'C:/mahaa/.e2e-media';

/** A solid-colour PNG with a visible band, so "did my image load" is unambiguous. */
function makePng(width, height, [r, g, b]) {
  const chunk = (kind, payload) => {
    const body = Buffer.concat([Buffer.from(kind, 'latin1'), payload]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 4;
      // A diagonal gradient plus a bright band, so a rendered image is
      // visibly this file and not a placeholder.
      const band = y > height * 0.4 && y < height * 0.6;
      raw[at] = band ? 255 : (x * 255) / width | 0;
      raw[at + 1] = band ? 255 : (y * 255) / height | 0;
      raw[at + 2] = b;
      raw[at + 3] = 255;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A valid image with the wrong MIME name, for the rejection test. */
function makeBadImage() {
  return Buffer.from(
    'This file is named .jpg but its bytes are plain text. The server sniffs ' +
      'magic bytes, so it must refuse this rather than trust the extension.',
    'utf8',
  );
}

/** A valid MP4, recorded by Edge itself so it actually decodes. */
async function makeRealMp4(cdp) {
  const page = await openPage(cdp, 'about:blank');
  try {
    const base64 = await page.eval(`
      const supported = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp8'];
      const mimeType = supported.find((t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType) return { error: 'no supported recorder mime type' };

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');

      const stream = canvas.captureStream(25);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000 });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();

      // ~3 seconds of real motion. A static frame would encode to something a
      // decoder may collapse away, and the test would be measuring nothing.
      for (let frame = 0; frame < 75; frame += 1) {
        ctx.fillStyle = '#101322';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = '#5ee7a8';
        const x = (frame / 75) * 560;
        ctx.fillRect(x, 140 + Math.sin(frame / 6) * 60, 64, 64);
        ctx.fillStyle = '#ffffff';
        ctx.font = '32px sans-serif';
        ctx.fillText('frame ' + frame, 24, 44);
        await new Promise((r) => setTimeout(r, 40));
      }

      recorder.stop();
      await stopped;
      if (!chunks.length) return { error: 'recorder produced no data' };

      const blob = new Blob(chunks, { type: mimeType });
      const buffer = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      return { mimeType, bytes: bytes.length, base64: btoa(binary) };
    `);
    if (base64.error || !base64.base64) {
      throw new Error(`could not record an MP4: ${base64.error ?? 'empty result'}`);
    }
    const buffer = Buffer.from(base64.base64, 'base64');
    writeFileSync(`${OUT}/clip.mp4`, buffer);
    return { mimeType: base64.mimeType, bytes: buffer.length };
  } finally {
    await page.close();
  }
}

const cdp = await connect();
try {
  const png = makePng(900, 600, [90, 140, 255]);
  writeFileSync(`${OUT}/photo.png`, png);
  writeFileSync(`${OUT}/second.png`, makePng(640, 640, [255, 140, 90]));
  writeFileSync(`${OUT}/not-really.jpg`, makeBadImage());
  writeFileSync(`${OUT}/fake.mp4`, makeBadImage());
  console.log(`PNG written: ${png.length} bytes`);

  const video = await makeRealMp4(cdp);
  console.log(`MP4 recorded: ${video.bytes} bytes (${video.mimeType})`);
} finally {
  cdp.close();
}
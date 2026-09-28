/**
 * Generate the development-only demo feed images.
 *
 * Run once with `node ./scripts/generate-demo-feed-assets.mjs`; it writes
 * schematic, clearly-illustrative PNGs into `assets/demo/`.
 *
 * Why a generator instead of bundled photographs:
 *
 *  - **Licence-clean.** Every pixel is produced here from arithmetic plus a
 *    5x7 bitmap font defined in this file, so there is no third-party image,
 *    no attribution obligation, and nothing to license.
 *  - **No dependency.** PNG's container is written by hand and compressed with
 *    Node's built-in `zlib`, so this adds nothing to `package.json`.
 *  - **Offline and permanent.** The images are committed, so a demo feed never
 *    depends on a remote host staying up.
 *  - **Never mistakable for real work.** Each image is deliberately a *mockup*
 *    — flat blocks and schematic UI shapes, never a photograph — and each one
 *    carries a visible DEMO watermark. A demo post can therefore never be
 *    mistaken for a real student's project or certificate.
 *
 * The images are removed along with the rest of the demo layer: they are
 * referenced only from `src/features/feed/demoFeedPosts.ts`, which is compiled
 * out of a production bundle by `__DEV__`.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'demo');
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'features', 'feed');

/* -------------------------------------------------------------------------- */
/* PNG encoder                                                                 */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes a raw RGBA buffer as a PNG: truecolour + alpha, 8 bits, no interlace. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte (0 = none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                      */
/* -------------------------------------------------------------------------- */

/** Palette shared by every demo image — the product's blue plus neutral greys. */
const C = {
  white: [255, 255, 255, 255],
  page: [241, 245, 249, 255],
  surface: [255, 255, 255, 255],
  muted: [248, 250, 252, 255],
  border: [226, 232, 240, 255],
  borderStrong: [203, 213, 225, 255],
  slate900: [15, 23, 42, 255],
  slate700: [51, 65, 85, 255],
  slate500: [100, 116, 139, 255],
  slate400: [148, 163, 184, 255],
  blue600: [37, 99, 235, 255],
  blue400: [96, 165, 250, 255],
  blue50: [239, 246, 255, 255],
  emerald600: [5, 150, 105, 255],
  amber600: [217, 119, 6, 255],
  navy900: [15, 23, 42, 255],
  overlay: [15, 23, 42, 150],
};

class Canvas {
  constructor(width, height, background = C.page) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
    this.fillRect(0, 0, width, height, background);
  }

  /** Solid rectangle, clipped to the canvas. */
  fillRect(x, y, w, h, color) {
    const [r, g, b, a] = color;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));

    for (let py = y0; py < y1; py += 1) {
      let index = (py * this.width + x0) * 4;
      for (let px = x0; px < x1; px += 1) {
        this.pixels[index] = r;
        this.pixels[index + 1] = g;
        this.pixels[index + 2] = b;
        this.pixels[index + 3] = a;
        index += 4;
      }
    }
  }

  /** Rectangle outline — the mockups' card and frame edges. */
  strokeRect(x, y, w, h, color, thickness = 1) {
    this.fillRect(x, y, w, thickness, color);
    this.fillRect(x, y + h - thickness, w, thickness, color);
    this.fillRect(x, y, thickness, h, color);
    this.fillRect(x + w - thickness, y, thickness, h, color);
  }

  /** Filled circle, drawn with a squared-radius test so no anti-aliasing is needed. */
  fillCircle(cx, cy, radius, color) {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      if (y < 0 || y >= this.height) continue;
      const dy = y - cy;
      const span = Math.sqrt(Math.max(0, r2 - dy * dy));
      this.fillRect(cx - span, y, span * 2, 1, color);
    }
  }

  /** A stack of placeholder bars — the universal "text lives here" shape. */
  textLines(x, y, widths, lineHeight, color, thickness = 8) {
    widths.forEach((width, index) => {
      this.fillRect(x, y + index * lineHeight, width, thickness, color);
    });
  }

  toPng() {
    return encodePng(this.width, this.height, this.pixels);
  }
}

/* -------------------------------------------------------------------------- */
/* 5x7 bitmap font — defined here, so no font file is licensed or shipped.      */
/* -------------------------------------------------------------------------- */

// prettier-ignore
const GLYPHS = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01110','10001','10000','10000','10000','10001','01110'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01110','10001','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  J: ['00111','00010','00010','00010','00010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','11011','10001'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  0: ['01110','10001','10011','10101','11001','10001','01110'],
  1: ['00100','01100','00100','00100','00100','00100','01110'],
  2: ['01110','10001','00001','00010','00100','01000','11111'],
  3: ['11111','00010','00100','00010','00001','10001','01110'],
  4: ['00010','00110','01010','10010','11111','00010','00010'],
  5: ['11111','10000','11110','00001','00001','10001','01110'],
  6: ['00110','01000','10000','11110','10001','10001','01110'],
  7: ['11111','00001','00010','00100','01000','01000','01000'],
  8: ['01110','10001','10001','01110','10001','10001','01110'],
  9: ['01110','10001','10001','01111','00001','00010','01100'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','01100','01100'],
  ':': ['00000','01100','01100','00000','01100','01100','00000'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
  '+': ['00000','00100','00100','11111','00100','00100','00000'],
};

/** Rendered width of a string in pixels, for centring. */
function textWidth(text, scale) {
  return text.length * 6 * scale - scale;
}

/**
 * Draws uppercase text at `scale`. An unknown character renders as a blank
 * rather than throwing, so a stray glyph can never break asset generation.
 */
function drawText(canvas, text, x, y, scale, color) {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = GLYPHS[raw] ?? GLYPHS[' '];
    glyph.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] === '1') {
          canvas.fillRect(cursor + column * scale, y + rowIndex * scale, scale, scale, color);
        }
      }
    });
    cursor += 6 * scale;
  }
}

/** Draws text centred horizontally inside `[x, x + width)`. */
function drawTextCentered(canvas, text, x, width, y, scale, color) {
  drawText(canvas, text, x + Math.round((width - textWidth(text, scale)) / 2), y, scale, color);
}

/* -------------------------------------------------------------------------- */
/* Watermark — every demo image states that it is a mockup                      */
/* -------------------------------------------------------------------------- */

/**
 * A visible DEMO band in the top-left corner.
 *
 * This is the image-level counterpart of `DEMO_POST_BADGE`: it means a saved or
 * screenshotted demo image still announces itself, outside the app.
 */
function watermark(canvas, label = 'DEMO') {
  const scale = 3;
  const width = textWidth(`${label} - ILLUSTRATIVE MOCKUP`, scale) + 32;
  canvas.fillRect(0, 0, width, 46, C.navy900);
  drawText(canvas, `${label} - ILLUSTRATIVE MOCKUP`, 16, 13, scale, C.white);
}

/* -------------------------------------------------------------------------- */
/* Scene 1 — a project screenshot mockup                                        */
/* -------------------------------------------------------------------------- */

/** Campus event platform: browser chrome, sidebar, stat cards, event list. */
function drawProjectScreenshot() {
  const canvas = new Canvas(1280, 800, C.page);

  // Browser chrome.
  canvas.fillRect(0, 0, 1280, 56, C.navy900);
  [C.amber600, C.slate400, C.emerald600].forEach((dot, index) => {
    canvas.fillCircle(32 + index * 26, 28, 7, dot);
  });
  canvas.fillRect(120, 16, 400, 26, C.slate700);
  drawText(canvas, 'CAMPUSEVENTS.LOCAL', 132, 22, 2, C.slate400);

  // App shell: sidebar + content surface.
  canvas.fillRect(0, 56, 240, 744, C.white);
  canvas.fillRect(240, 56, 1, 744, C.border);
  canvas.fillRect(40, 88, 120, 14, C.blue600);
  canvas.textLines(40, 136, [140, 108, 128, 96, 116], 34, C.borderStrong, 10);

  // Header bar inside the content area.
  const contentX = 288;
  const contentW = 1280 - contentX - 48;
  canvas.fillRect(contentX, 96, contentW, 44, C.muted);
  drawText(canvas, 'EVENTS DASHBOARD', contentX + 16, 108, 2, C.slate700);
  canvas.fillRect(contentX + contentW - 132, 104, 116, 28, C.blue600);
  drawTextCentered(canvas, 'NEW EVENT', contentX + contentW - 132, 116, 112, 2, C.white);

  // Three stat cards.
  const cardW = Math.round((contentW - 32) / 3);
  [0, 1, 2].forEach((index) => {
    const x = contentX + index * (cardW + 16);
    canvas.fillRect(x, 168, cardW, 104, C.surface);
    canvas.strokeRect(x, 168, cardW, 104, C.border, 2);
    canvas.fillRect(x + 20, 192, 74, 10, C.slate400);
    canvas.fillRect(x + 20, 216, 108, 22, C.slate900);
    canvas.fillRect(x + 20, 248, 56, 8, C.blue400);
  });

  // Event list rows, each with a coloured leading block.
  const accent = [C.blue600, C.emerald600, C.amber600];
  [0, 1, 2, 3].forEach((index) => {
    const y = 296 + index * 112;
    canvas.fillRect(contentX, y, contentW, 96, C.surface);
    canvas.strokeRect(contentX, y, contentW, 96, C.border, 2);
    canvas.fillRect(contentX + 20, y + 20, 56, 56, accent[index % accent.length]);
    canvas.fillRect(contentX + 96, y + 24, 260, 12, C.slate700);
    canvas.fillRect(contentX + 96, y + 48, 380, 10, C.borderStrong);
    canvas.fillRect(contentX + 96, y + 68, 180, 10, C.borderStrong);
    canvas.fillRect(contentX + contentW - 168, y + 20, 148, 30, C.blue50);
    canvas.strokeRect(contentX + contentW - 168, y + 20, 148, 30, C.blue400, 2);
    drawTextCentered(canvas, 'REGISTERED', contentX + contentW - 168, 148, y + 28, 2, C.blue600);
  });

  // Pagination dots at the foot.
  canvas.textLines(contentX, 752, [96, 140, 72], 18, C.border, 8);

  watermark(canvas);
  return canvas;
}

/* -------------------------------------------------------------------------- */
/* Scene 2 — a certificate mockup                                               */
/* -------------------------------------------------------------------------- */

/** Certificate of completion: navy frame, seal, rules, signature line. */
function drawCertificate() {
  const canvas = new Canvas(1280, 900, C.white);

  canvas.fillRect(0, 0, 1280, 900, C.navy900);
  canvas.fillRect(28, 28, 1224, 844, C.white);
  canvas.strokeRect(56, 56, 1168, 788, C.blue400, 3);

  // Issuer line and title, centred on the document.
  drawTextCentered(canvas, 'DEMO ACADEMY OF TECHNOLOGY', 56, 1168, 110, 2, C.slate500);
  canvas.fillRect(472, 148, 336, 4, C.blue600);
  drawTextCentered(canvas, 'CERTIFICATE OF COMPLETION', 56, 1168, 190, 4, C.slate900);

  drawTextCentered(canvas, 'THIS IS TO CERTIFY THAT', 56, 1168, 288, 2, C.slate500);
  drawTextCentered(canvas, 'PRIYA SHARMA', 56, 1168, 336, 6, C.blue600);
  canvas.fillRect(352, 404, 576, 3, C.borderStrong);

  canvas.textLines(420, 456, [440, 380, 400], 40, C.slate400, 10);

  // Seal: two concentric rings with a ribbon.
  const sealX = 300;
  const sealY = 660;
  canvas.fillCircle(sealX, sealY, 78, C.blue50);
  canvas.fillCircle(sealX, sealY, 60, C.blue600);
  canvas.fillCircle(sealX, sealY, 46, C.white);
  drawTextCentered(canvas, 'DEMO', sealX - 78, 156, sealY - 10, 3, C.blue600);
  canvas.fillRect(sealX - 34, sealY + 74, 22, 72, C.blue400);
  canvas.fillRect(sealX + 12, sealY + 74, 22, 72, C.blue600);

  // Signature and date blocks.
  [
    { x: 560, caption: 'PROGRAM DIRECTOR' },
    { x: 880, caption: 'DATE OF ISSUE' },
  ].forEach((block) => {
    canvas.fillRect(block.x, 624, 260, 10, C.slate900);
    canvas.fillRect(block.x, 634, 260, 2, C.borderStrong);
    drawText(canvas, block.caption, block.x, 654, 2, C.slate500);
  });

  watermark(canvas);
  return canvas;
}

/* -------------------------------------------------------------------------- */
/* Scene 3 — three workshop / event mockups (one multi-image demo post)         */
/* -------------------------------------------------------------------------- */

/** The three variants differ by accent and composition so paging is visible. */
const EVENT_VARIANTS = [
  { accent: C.blue600, soft: C.blue50, banner: 'WORKSHOP ON WEB ACCESSIBILITY' },
  { accent: C.emerald600, soft: C.muted, banner: 'CAMPUS HACKATHON - DAY ONE' },
  { accent: C.amber600, soft: C.muted, banner: 'OPEN SOURCE CONTRIBUTION DRIVE' },
];

/** A schematic event room: projector screen, speaker, front rows of seating. */
function drawEventScene(index) {
  const variant = EVENT_VARIANTS[index % EVENT_VARIANTS.length];
  const canvas = new Canvas(1200, 800, C.page);

  // Back wall with a hanging banner.
  canvas.fillRect(0, 0, 1200, 460, C.white);
  canvas.fillRect(60, 40, 1080, 96, variant.soft);
  canvas.strokeRect(60, 40, 1080, 96, variant.accent, 3);
  drawTextCentered(canvas, variant.banner, 60, 1080, 74, 3, variant.accent);

  // Projector screen with content blocks.
  canvas.fillRect(200, 168, 800, 232, C.navy900);
  canvas.fillRect(232, 200, 340, 16, variant.accent);
  canvas.textLines(232, 240, [520, 460, 300], 34, C.slate400, 12);
  canvas.fillRect(760, 240, 208, 128, variant.accent);
  drawTextCentered(canvas, 'SLIDE 1', 760, 208, 296, 3, C.white);

  // Speaker podium.
  canvas.fillRect(126, 400, 150, 60, variant.accent);
  canvas.fillRect(184, 356, 34, 44, C.slate700);
  canvas.fillCircle(201, 336, 24, C.slate500);

  // Front rows of seating, staggered so the depth reads.
  const rows = [
    { y: 560, count: 7 },
    { y: 646, count: 6 },
    { y: 732, count: 5 },
  ];
  rows.forEach((row, rowIndex) => {
    const seatW = 120;
    const totalWidth = row.count * seatW + (row.count - 1) * 20;
    const startX = Math.round((1200 - totalWidth) / 2);
    for (let seat = 0; seat < row.count; seat += 1) {
      const x = startX + seat * (seatW + 20);
      canvas.fillRect(x, row.y, seatW, 56, rowIndex === 0 ? C.slate400 : C.borderStrong);
      canvas.fillRect(x + 14, row.y + 44, seatW - 28, 12, C.border);
    }
  });

  watermark(canvas);
  return canvas;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The generated set. `width`/`height` are asserted against the canvas so a
 * future edit cannot silently change an image's intrinsic aspect ratio, which
 * the post card uses to size it without cropping.
 */
const OUTPUTS = [
  { file: 'campus-event-platform.png', draw: drawProjectScreenshot, width: 1280, height: 800 },
  { file: 'certificate-course-completion.png', draw: drawCertificate, width: 1280, height: 900 },
  { file: 'workshop-opening-session.png', draw: () => drawEventScene(0), width: 1200, height: 800 },
  { file: 'workshop-hackathon-day-one.png', draw: () => drawEventScene(1), width: 1200, height: 800 },
  { file: 'workshop-open-source-drive.png', draw: () => drawEventScene(2), width: 1200, height: 800 },
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SRC_DIR, { recursive: true });

  const embedded = [];

  for (const output of OUTPUTS) {
    const canvas = output.draw();
    if (canvas.width !== output.width || canvas.height !== output.height) {
      throw new Error(`${output.file}: canvas is ${canvas.width}x${canvas.height}`);
    }

    const png = canvas.toPng();
    writeFileSync(join(OUT_DIR, output.file), png);
    embedded.push({
      key: output.file.replace(/\.png$/, ''),
      width: output.width,
      height: output.height,
      base64: png.toString('base64'),
    });
    console.log(
      `${output.file.padEnd(36)} ${output.width}x${output.height}  ${Math.round(png.length / 1024)} KB`,
    );
  }

  writeFileSync(join(SRC_DIR, 'demoFeedAssets.ts'), assetsModule(embedded));
  console.log(`\n${OUTPUTS.length} demo images written to assets/demo/`);
  console.log(`asset module written to src/features/feed/demoFeedAssets.ts`);
}

/**
 * The generated TypeScript module.
 *
 * The images are embedded as data URIs rather than imported as files for one
 * decisive reason: the feed model stores a media **URI string**, which is
 * exactly the shape a real media API returns later (`{ uri }`, the same way
 * `Avatar` already consumes a remote avatar URL). A bundler-imported asset is a
 * numeric handle on native and undefined in Node, so the demo dataset could not
 * be unit tested — and `expo/types` declares no `*.png` module, so a file import
 * would not typecheck either.
 *
 * The cost is bundle weight for bytes that a release build never renders. That
 * cost is bounded and reversible: the demo dataset is gated by `__DEV__`, and
 * deleting this file plus `demoFeedPosts.ts` removes every byte of it.
 */
function assetsModule(entries) {
  const records = entries
    .map(
      (entry) => `  '${entry.key}': {
    uri: 'data:image/png;base64,${entry.base64}',
    width: ${entry.width},
    height: ${entry.height},
  },`,
    )
    .join('\n');

  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by \`node ./scripts/generate-demo-feed-assets.mjs\`, which draws the
 * images from scratch (licence-clean, no third-party artwork) and embeds them
 * here as PNG data URIs. Re-run that script after changing any drawing code.
 *
 * These images belong to the development-only demo feed. They are referenced
 * only by \`demoFeedPosts.ts\`, which \`__DEV__\` keeps out of a release render.
 * Every image carries a visible "DEMO - ILLUSTRATIVE MOCKUP" watermark, so a
 * demo post can never be mistaken for a real project or certificate.
 *
 * The matching, human-viewable PNGs are written to \`assets/demo/\`.
 */

export interface DemoFeedImage {
  /** PNG data URI — the same \`uri\` shape a media API will return. */
  readonly uri: string;
  /** Intrinsic size, so a card can size the image without cropping it. */
  readonly width: number;
  readonly height: number;
}

export const DEMO_FEED_IMAGES = {
${records}
} as const satisfies Record<string, DemoFeedImage>;

export type DemoFeedImageKey = keyof typeof DEMO_FEED_IMAGES;
`;
}

main();


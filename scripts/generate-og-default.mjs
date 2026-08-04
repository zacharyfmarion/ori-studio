#!/usr/bin/env node
/**
 * Generate `apps/web/public/og-default.png` — the fallback card served whenever a share
 * has no preview image: not uploaded yet, upload failed, or expired from R2 after a year.
 *
 * Written as a script rather than a checked-in binary blob nobody can regenerate. It draws
 * a bird-base-ish crease pattern with the same palette the real export uses
 * (`CREASE_EXPORT_PALETTES.light` in apps/web/src/lib/creaseExport.ts), so the fallback
 * reads as the same family of image as the cards it stands in for.
 *
 *   node scripts/generate-og-default.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Must equal SHARE_CARD_WIDTH/HEIGHT in apps/web/src/lib/creaseExport.ts — the fallback
// should be the same surface as the cards it stands in for, and a test pins the two.
const WIDTH = 1000;
const HEIGHT = 525;

// CREASE_EXPORT_PALETTES.light
const CANVAS = [0xff, 0xff, 0xff];
const PAPER = [0xf8, 0xf5, 0xec];
const MOUNTAIN = [0xff, 0x4d, 0x5d];
const VALLEY = [0x60, 0xa5, 0xfa];
const BORDER = [0x11, 0x14, 0x17];

/** Square sheet, centred, with a margin that matches the export's visual weight. */
const SHEET = 400;
const ORIGIN_X = (WIDTH - SHEET) / 2;
const ORIGIN_Y = (HEIGHT - SHEET) / 2;

const pixels = new Uint8Array(WIDTH * HEIGHT * 3);

function fill(color) {
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    pixels[i * 3] = color[0];
    pixels[i * 3 + 1] = color[1];
    pixels[i * 3 + 2] = color[2];
  }
}

function setPixel(x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return;
  const i = (py * WIDTH + px) * 3;
  pixels[i] = color[0];
  pixels[i + 1] = color[1];
  pixels[i + 2] = color[2];
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
    for (let x = Math.round(x0); x < Math.round(x1); x += 1) setPixel(x, y, color);
  }
}

/** Thick line via perpendicular offsets — no antialiasing, which line art does not miss. */
function line(x0, y0, x1, y1, color, weight = 3) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) * 2);
  const nx = -dy / Math.hypot(dx, dy);
  const ny = dx / Math.hypot(dx, dy);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    for (let w = -(weight - 1) / 2; w <= (weight - 1) / 2; w += 0.5) {
      setPixel(x + nx * w, y + ny * w, color);
    }
  }
}

/** Sheet-local coordinates in 0..1. */
const sx = (u) => ORIGIN_X + u * SHEET;
const sy = (v) => ORIGIN_Y + v * SHEET;
const seg = (u0, v0, u1, v1, color, weight) =>
  line(sx(u0), sy(v0), sx(u1), sy(v1), color, weight);

fill(CANVAS);
fillRect(ORIGIN_X, ORIGIN_Y, ORIGIN_X + SHEET, ORIGIN_Y + SHEET, PAPER);

// Diagonals and medians — the folds every classic base starts from.
seg(0, 0, 1, 1, MOUNTAIN, 3);
seg(1, 0, 0, 1, MOUNTAIN, 3);
seg(0.5, 0, 0.5, 1, VALLEY, 3);
seg(0, 0.5, 1, 0.5, VALLEY, 3);

// Corner-to-midpoint creases: enough structure to read as a crease pattern rather than
// a decorative asterisk.
seg(0, 0, 0.5, 0, VALLEY, 2);
seg(0.5, 0, 1, 0, VALLEY, 2);
for (const [u0, v0, u1, v1] of [
  [0, 0.5, 0.5, 1],
  [0.5, 1, 1, 0.5],
  [1, 0.5, 0.5, 0],
  [0.5, 0, 0, 0.5],
]) {
  seg(u0, v0, u1, v1, MOUNTAIN, 2);
}
for (const [u0, v0, u1, v1] of [
  [0.25, 0.25, 0.75, 0.25],
  [0.25, 0.75, 0.75, 0.75],
  [0.25, 0.25, 0.25, 0.75],
  [0.75, 0.25, 0.75, 0.75],
]) {
  seg(u0, v0, u1, v1, VALLEY, 2);
}

// Border last, so it sits over every crease that runs into it.
seg(0, 0, 1, 0, BORDER, 4);
seg(1, 0, 1, 1, BORDER, 4);
seg(1, 1, 0, 1, BORDER, 4);
seg(0, 1, 0, 0, BORDER, 4);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

// One filter byte per scanline. Filter 0 (none) keeps this simple; the image is flat
// colour and deflate handles the repetition.
const raw = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
for (let y = 0; y < HEIGHT; y += 1) {
  raw[y * (WIDTH * 3 + 1)] = 0;
  Buffer.from(pixels.buffer, y * WIDTH * 3, WIDTH * 3).copy(raw, y * (WIDTH * 3 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'web',
  'public',
  'og-default.png'
);
writeFileSync(target, png);
console.log(`Wrote ${target} (${WIDTH}x${HEIGHT}, ${png.length} bytes)`);

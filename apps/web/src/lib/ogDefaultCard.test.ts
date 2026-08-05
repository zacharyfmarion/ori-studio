import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './creaseExport';

/**
 * The card served whenever a share has no preview image of its own — not uploaded yet,
 * upload failed, or expired from R2 after a year.
 *
 * It has to be the same surface as the cards it stands in for. It already drifted once:
 * the card geometry moved to 1000x525 and this stayed at 1200x630, and because both are
 * 1.91:1 nothing looked wrong, so nothing surfaced it. Regenerate with
 * `node scripts/generate-og-default.mjs` if this fails.
 */
const CARD = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'og-default.png')
);

describe('og-default.png', () => {
  it('is a real PNG, since the Worker serves it as one', () => {
    expect([...CARD.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('matches the share card geometry exactly', () => {
    // IHDR is the first chunk: 8 bytes signature + 4 length + 4 type, then width and height.
    expect(CARD.readUInt32BE(16)).toBe(SHARE_CARD_WIDTH);
    expect(CARD.readUInt32BE(20)).toBe(SHARE_CARD_HEIGHT);
  });

  it('is large enough to pass the blank-card guard it stands in for', () => {
    expect(CARD.byteLength).toBeGreaterThan(2_048);
  });
});

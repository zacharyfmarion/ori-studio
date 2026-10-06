import { describe, expect, it } from 'vitest';
import imprints from './__fixtures__/zoomImprint.json';

/**
 * What a flat capture's faces cost in the file (Revision 2, "The budget"):
 * every capture's `paperFaces` at most 0.3 of its `sceneJson`, both as the
 * project file writes them — strings, their quotes escaped — over 16.0's
 * captures of Zach's crane. `artifacts/revision-2/16c/paperFacesBudget.mjs`
 * weighs the whole file, every flat step refreshed, against the other half of
 * the budget: at most 1%.
 *
 * Breaking it does not raise it: the numbers go to Zach (the plan's "Model
 * and file format"). The budget is asserted over every capture, so a breach
 * shows here rather than in a filter.
 */
const captures = imprints.captures as Record<string, { sceneJson: string; paperFaces: string; spread: unknown }>;

/** Bytes as the project file writes a string: JSON-escaped, UTF-8. */
const inFile = (text: string) => new TextEncoder().encode(JSON.stringify(text)).length;

const ratio = (key: string) => inFile(captures[key]!.paperFaces) / inFile(captures[key]!.sceneJson);
const spread = Object.keys(captures).filter((key) => captures[key]!.spread !== null);
const unspread = Object.keys(captures).filter((key) => captures[key]!.spread === null);

describe('the faces’ size budget: each capture’s faces at most 0.3 of its scene, as the file writes them', () => {
  it('holds on every capture with its layers spread (16.0: 0.24–0.26)', () => {
    expect(spread.length).toBeGreaterThanOrEqual(6);
    for (const key of spread) expect(ratio(key), key).toBeLessThanOrEqual(0.3);
  });

  // BREACHED, and with Zach (16c review, 2026-10-06). With no spread the stored
  // scene drops the faces it hides, so it is small, while the faces keep every
  // face: S, C and R21 come to 1.35–1.45. The faces' bytes barely differ from
  // the spread captures'; the ratio breaks because the scene shrinks. The plan
  // stops here rather than raise the budget. Until Zach answers — a file-level
  // cap in place of this ratio, or the plan's lever, faces kept only on steps
  // that hold an area or a frame — this says the breach is still there, and
  // fails the day it is not, so this test is rewritten with his answer.
  it.fails('holds on every capture with no spread — BREACHED, awaiting Zach', () => {
    expect(unspread.length).toBeGreaterThanOrEqual(3);
    for (const key of unspread) expect(ratio(key), key).toBeLessThanOrEqual(0.3);
  });
});

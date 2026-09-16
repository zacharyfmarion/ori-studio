import { describe, expect, it } from 'vitest';
import markCentreFixture from './referenceFinder/__fixtures__/mark-centre.json';
import { extractSolution } from './referenceFinder/extractor';
import type { ReferenceFinderReplayFixture } from './referenceFinder/replayClient';
import { shownCandidates } from './referencesShownCandidates';

const centre = markCentreFixture as unknown as ReferenceFinderReplayFixture;

describe('shownCandidates', () => {
  it('lists only the exact answers when approximate ones are not asked for', () => {
    const candidates = [{ exact: true }, { exact: false }, { exact: false }];
    expect(shownCandidates(candidates, false)).toEqual([0]);
  });

  it('lists every answer when approximate ones are asked for', () => {
    const candidates = [{ exact: false }, { exact: true }, { exact: false }];
    expect(shownCandidates(candidates, true)).toEqual([0, 1, 2]);
  });

  it('falls back to the closest constructions when nothing is exact', () => {
    const candidates = [{ exact: false }, { exact: false }];
    expect(shownCandidates(candidates, false)).toEqual([0, 1]);
    expect(shownCandidates([], false)).toEqual([]);
  });

  it("drops the sheet centre's near misses: a mark a quarter of a thousandth off, at rank 6", () => {
    // The core keeps one mark per position, so the answers after the exact
    // one are its nearest neighbours, never a second exact route — and their
    // constructions read as nonsense (a "corner" made by a pinch).
    const sheet = { width: centre.database.width, height: centre.database.height };
    const solutions = centre.solutions.map((raw) => extractSolution(raw, centre.query, sheet));
    expect(solutions.map((s) => s.exact)).toEqual([true, false, false, false, false]);
    expect(solutions.slice(1).every((s) => s.err > 2e-4 && s.err < 3e-4)).toBe(true);
    expect(shownCandidates(solutions, false)).toEqual([0]);
    expect(shownCandidates(solutions, true)).toEqual([0, 1, 2, 3, 4]);
  });
});

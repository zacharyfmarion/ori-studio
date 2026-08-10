import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import {
  cpLinesByIds,
  foldedSourceBounds,
  foldedSourceFingerprint,
  isFoldedFigureStale,
  reselectFoldableLineIds,
  reselectSourceLineIds,
  segmentOverlapsBounds,
} from './foldedFigureStaleness';

function line(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color = 'Black0',
  overrides: Partial<OristudioCpLineSegment> = {}
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: '',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...overrides,
  } as OristudioCpLineSegment;
}

function doc(lines: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: {
      line_segments: lines,
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: {},
    },
    metadata: {},
  } as unknown as OristudioCpDocumentSnapshot;
}

// A unit square of border creases plus one interior mountain fold.
const SQUARE: OristudioCpLineSegment[] = [
  line(0, 0, 1, 0),
  line(1, 0, 1, 1),
  line(1, 1, 0, 1),
  line(0, 1, 0, 0),
  line(0, 0, 1, 1, 'Red1'),
];
const SQUARE_IDS = [1, 2, 3, 4, 5];

function figureFrom(
  document: OristudioCpDocumentSnapshot,
  lineIds: number[],
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  const bounds = foldedSourceBounds(cpLinesByIds(document, lineIds));
  const reselected = cpLinesByIds(document, reselectFoldableLineIds(document, bounds));
  return {
    id: 'folded-1',
    sourceKind: 'generated-from-current-cp',
    status: 'ready',
    sourceBounds: bounds,
    sourceFingerprint: foldedSourceFingerprint(reselected),
    sourceLineIds: lineIds,
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

describe('foldedSourceBounds', () => {
  // Port of GetBoundingBox.getBoundingBox.
  it('spans every endpoint of the folded set', () => {
    expect(foldedSourceBounds(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it('is null for an empty set', () => {
    expect(foldedSourceBounds([])).toBeNull();
  });
});

describe('segmentOverlapsBounds', () => {
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  // Oriedita's totu_boundary_inside returns true when *any part* of the segment
  // touches the region, not when the segment is contained by it: it tests
  // intersection with each boundary edge, then falls back to "is the midpoint
  // inside". These cases pin that meaning.
  it('accepts a segment wholly inside', () => {
    expect(segmentOverlapsBounds(line(2, 2, 8, 8), bounds)).toBe(true);
  });

  it('accepts a segment that merely crosses the region', () => {
    // Neither endpoint is inside, but the segment passes straight through.
    expect(segmentOverlapsBounds(line(-5, 5, 15, 5), bounds)).toBe(true);
  });

  it('accepts a segment with one endpoint inside', () => {
    expect(segmentOverlapsBounds(line(5, 5, 50, 50), bounds)).toBe(true);
  });

  it('accepts a segment lying along the boundary', () => {
    expect(segmentOverlapsBounds(line(0, 0, 0, 10), bounds)).toBe(true);
  });

  it('rejects a segment entirely outside', () => {
    expect(segmentOverlapsBounds(line(20, 20, 30, 30), bounds)).toBe(false);
  });

  it('rejects a segment parallel to and beyond an edge', () => {
    expect(segmentOverlapsBounds(line(-5, 20, 15, 20), bounds)).toBe(false);
  });

  it('handles a degenerate point segment', () => {
    expect(segmentOverlapsBounds(line(5, 5, 5, 5), bounds)).toBe(true);
    expect(segmentOverlapsBounds(line(50, 50, 50, 50), bounds)).toBe(false);
  });
});

describe('reselectFoldableLineIds', () => {
  it('re-derives the folded set from the recorded region', () => {
    const document = doc(SQUARE);
    const bounds = foldedSourceBounds(SQUARE);
    expect(reselectFoldableLineIds(document, bounds)).toEqual(SQUARE_IDS);
  });

  it('skips auxiliary colours, matching getSaveForSelectFolding', () => {
    // Cyan3 is an auxiliary line: is_folding_line() is false upstream.
    const document = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.8, 'Cyan3')]);
    expect(reselectFoldableLineIds(document, foldedSourceBounds(SQUARE))).toEqual(SQUARE_IDS);
  });

  it('picks up a crease added inside the region since the fold', () => {
    const document = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.2, 'Blue2')]);
    expect(reselectFoldableLineIds(document, foldedSourceBounds(SQUARE))).toEqual([
      ...SQUARE_IDS,
      6,
    ]);
  });

  it('ignores creases outside the region', () => {
    const document = doc([...SQUARE, line(5, 5, 6, 6)]);
    expect(reselectFoldableLineIds(document, foldedSourceBounds(SQUARE))).toEqual(SQUARE_IDS);
  });

  it('returns nothing without a document or a region', () => {
    expect(reselectFoldableLineIds(null, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toEqual([]);
    expect(reselectFoldableLineIds(doc(SQUARE), null)).toEqual([]);
  });
});

describe('reselectSourceLineIds', () => {
  it('keeps the auxiliary lines its folding-line sibling drops', () => {
    // The whole reason it exists. A *region* is matched by every crease inside
    // it, construction lines included, so `resolveInlineSimulationRegion`
    // refuses the folding-line set — which is what sent the verdict chip's
    // "Simulate instead" to the Simulate panel instead of opening inline.
    const document = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.8, 'Cyan3')]);
    const bounds = foldedSourceBounds(SQUARE);
    expect(reselectFoldableLineIds(document, bounds)).toEqual(SQUARE_IDS);
    expect(reselectSourceLineIds(document, bounds)).toEqual([...SQUARE_IDS, 6]);
  });

  it('is still bounded by the region, and still needs both inputs', () => {
    expect(reselectSourceLineIds(doc([...SQUARE, line(5, 5, 6, 6, 'Cyan3')]), foldedSourceBounds(SQUARE))).toEqual(
      SQUARE_IDS
    );
    expect(reselectSourceLineIds(null, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toEqual([]);
    expect(reselectSourceLineIds(doc(SQUARE), null)).toEqual([]);
  });
});

describe('foldedSourceFingerprint', () => {
  // Port of LineSegmentSet.contentEquals: equal counts, same members, order
  // irrelevant.
  it('ignores ordering', () => {
    expect(foldedSourceFingerprint(SQUARE)).toBe(foldedSourceFingerprint([...SQUARE].reverse()));
  });

  it('changes when an endpoint moves', () => {
    const moved = [line(0, 0, 1.5, 0), ...SQUARE.slice(1)];
    expect(foldedSourceFingerprint(moved)).not.toBe(foldedSourceFingerprint(SQUARE));
  });

  it('changes when a crease changes colour', () => {
    const recoloured = [line(0, 0, 1, 1, 'Blue2'), ...SQUARE.slice(1)];
    expect(foldedSourceFingerprint(recoloured)).not.toBe(foldedSourceFingerprint(SQUARE));
  });

  it('changes when a crease is added or removed', () => {
    expect(foldedSourceFingerprint(SQUARE.slice(1))).not.toBe(foldedSourceFingerprint(SQUARE));
  });

  it('distinguishes duplicate creases by multiplicity', () => {
    expect(foldedSourceFingerprint([...SQUARE, SQUARE[0]!])).not.toBe(
      foldedSourceFingerprint(SQUARE)
    );
  });

  // Upstream compares `selected` too, but only ever between sets that came from
  // getSaveForSelectFolding, where it is uniformly 2. Ours varies with the
  // user's clicks, so including it would report every figure stale on selection.
  it('ignores selection state', () => {
    const selected = SQUARE.map((segment) => ({ ...segment, selected: 2 }));
    expect(foldedSourceFingerprint(selected)).toBe(foldedSourceFingerprint(SQUARE));
  });
});

describe('isFoldedFigureStale', () => {
  it('is false for a figure that still matches its creases', () => {
    const document = doc(SQUARE);
    expect(isFoldedFigureStale(document, figureFrom(document, SQUARE_IDS))).toBe(false);
  });

  it('is true when one of its creases moves', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE.slice(0, 4), line(0, 0, 0.5, 0.5, 'Red1')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(true);
  });

  it('is true when a crease is added inside its region', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.2, 'Blue2')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(true);
  });

  it('is true when one of its creases is recoloured', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE.slice(0, 4), line(0, 0, 1, 1, 'Blue2')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(true);
  });

  // The case the old always-stale flag got wrong: any edit anywhere marked every
  // figure out of date, including edits nowhere near it.
  it('is false for an edit outside its region', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE, line(5, 5, 6, 6), line(6, 6, 7, 7, 'Red1')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(false);
  });

  it('is false when creases are merely selected', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const selected = doc(SQUARE.map((segment) => ({ ...segment, selected: 2 })));
    expect(isFoldedFigureStale(selected, figure)).toBe(false);
  });

  it('is false without recorded provenance, so no refold is offered', () => {
    const document = doc(SQUARE);
    const legacy = figureFrom(document, SQUARE_IDS, {
      sourceBounds: null,
      sourceFingerprint: null,
    });
    const edited = doc(SQUARE.slice(1));
    expect(isFoldedFigureStale(edited, legacy)).toBe(false);
  });

  it('is false for an imported folded form, which has no creases here', () => {
    const document = doc(SQUARE);
    const imported = figureFrom(document, SQUARE_IDS, {
      sourceKind: 'imported-folded-form',
    });
    expect(isFoldedFigureStale(doc(SQUARE.slice(1)), imported)).toBe(false);
  });

  it('is false without a document', () => {
    const document = doc(SQUARE);
    expect(isFoldedFigureStale(null, figureFrom(document, SQUARE_IDS))).toBe(false);
  });
});

/** The pre-hash form, reproduced here so the compatibility path has something real to meet. */
function legacyFingerprint(lines: OristudioCpLineSegment[]): string {
  return lines
    .map((l) =>
      [l.a.x, l.a.y, l.b.x, l.b.y, l.active, l.color, l.customized,
        l.customized_color.red, l.customized_color.green, l.customized_color.blue].join(',')
    )
    .sort()
    .join(';');
}

function grid(count: number): OristudioCpLineSegment[] {
  return Array.from({ length: count }, (_, i) =>
    line(i * 0.3125, -200, i * 0.3125, 200, 'Red1')
  );
}

describe('fingerprint size', () => {
  it('does not grow with the number of creases', () => {
    // The reason for hashing at all. The old form was every crease key joined —
    // about 60 bytes each — so a figure over a dense region carried tens of
    // kilobytes into the .osf, and twenty of them megabytes, for a string
    // nothing ever reads.
    const small = foldedSourceFingerprint(grid(4));
    const large = foldedSourceFingerprint(grid(4000));
    expect(small.length).toBe(large.length);
    expect(large.length).toBeLessThan(32);
  });

  it('is still smaller than the legacy form at four creases', () => {
    // Not just asymptotically better — better immediately, so there is no size
    // at which the old form wins.
    expect(foldedSourceFingerprint(SQUARE).length).toBeLessThan(
      legacyFingerprint(SQUARE).length
    );
  });

  it('shrinks a dense region by orders of magnitude', () => {
    const dense = grid(2000);
    const ratio = legacyFingerprint(dense).length / foldedSourceFingerprint(dense).length;
    expect(ratio).toBeGreaterThan(1000);
  });
});

describe('a fingerprint written by the previous form', () => {
  it('does not match, and is meant not to', () => {
    // Deliberate: the joined form is not recognised. Files holding one show
    // their figures as Stale and offer a Refold, which rewrites the fingerprint
    // — self-correcting on the next save. Pinned so the behaviour is a decision
    // on the record rather than an omission someone later "fixes".
    expect(foldedSourceFingerprint(SQUARE)).not.toBe(legacyFingerprint(SQUARE));
  });

  it('is distinguishable from one this build wrote', () => {
    // What makes the above safe to reason about, and a future migration cheap.
    expect(foldedSourceFingerprint(SQUARE).startsWith('cs1:')).toBe(true);
    expect(legacyFingerprint(SQUARE).startsWith('cs1:')).toBe(false);
  });
});

describe('digest correctness', () => {
  it('separates the keys, so regrouping cannot collide', () => {
    // Without a separator per key the digest sees one byte stream, and two
    // different crease sets whose keys concatenate the same way would share a
    // fingerprint — a stale model that never says so.
    const a = [line(1, 2, 3, 4, 'Red1'), line(11, 22, 33, 44, 'Red1')];
    const b = [line(1, 22, 3, 44, 'Red1'), line(11, 2, 33, 4, 'Red1')];
    expect(foldedSourceFingerprint(a)).not.toBe(foldedSourceFingerprint(b));
  });

  it('gives distinct values across many near-identical crease sets', () => {
    // A weak digest shows up here rather than in a contrived case: these differ
    // only in one coordinate.
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      seen.add(foldedSourceFingerprint([line(0, 0, 400, i * 0.0625, 'Red1')]));
    }
    expect(seen.size).toBe(2000);
  });
});

describe('fold angle is part of a crease\'s identity', () => {
  // Colour used to be a crease's whole fold identity; it is now half of it, and
  // this fingerprint was written when that was still true. Leaving the magnitude
  // out made changing an angle invisible to the staleness check — a folded figure
  // and an inline simulation both kept claiming to match creases they no longer
  // did, because both derive from `foldedSourceFingerprint`.
  const at = (degrees?: number) =>
    line(0, 0, 100, 0, 'Red1', degrees === undefined ? {} : { fold_magnitude: degrees * 1e7 });

  it('separates a classic crease from a folded one', () => {
    expect(foldedSourceFingerprint([at()])).not.toBe(foldedSourceFingerprint([at(90)]));
  });

  it('separates two different angles', () => {
    expect(foldedSourceFingerprint([at(90)])).not.toBe(foldedSourceFingerprint([at(45)]));
  });

  it('separates angles that differ by one storage unit', () => {
    const a = line(0, 0, 100, 0, 'Red1', { fold_magnitude: 900000000 });
    const b = line(0, 0, 100, 0, 'Red1', { fold_magnitude: 900000001 });
    expect(foldedSourceFingerprint([a])).not.toBe(foldedSourceFingerprint([b]));
  });

  it('leaves a classic crease fingerprinting exactly as it did before the field existed', () => {
    // **The property the whole fix rests on.** An absent magnitude appends
    // nothing — not an empty field, which would leave a trailing separator — so
    // a pattern of classic creases hashes to the same value this produced
    // before `fold_magnitude` was added. That is what lets every fingerprint
    // already written to a `.osf` keep matching, with no migration and no bump
    // of the `cs1:` prefix.
    //
    // Pinned against a literal on purpose. Comparing against a freshly computed
    // value would pass however the key changed, which is no test at all; this
    // value was taken from the commit before `fold_magnitude` was added.
    expect(foldedSourceFingerprint([at()])).toBe('cs1:43bb54e33dc24da6');
  });

  it('reports a figure stale when only a fold angle changed', () => {
    const before = doc(SQUARE);
    const figure = figureFrom(before, SQUARE_IDS);
    expect(isFoldedFigureStale(before, figure)).toBe(false);

    const after = doc([
      ...SQUARE.slice(0, 4),
      line(0, 0, 1, 1, 'Red1', { fold_magnitude: 90 * 1e7 }),
    ]);
    expect(isFoldedFigureStale(after, figure)).toBe(true);
  });
});

/**
 * The source-kind guard fails **open**, which is why it needs its own test.
 *
 * Leave a kind out and nothing errors, nothing logs, and no type breaks: every
 * figure of that kind simply reports fresh forever, and `buildFoldedFigureActions`
 * drops Refold from the menu entirely rather than showing it disabled. The only
 * thing that notices is an assertion that says which kinds have creases to
 * drift.
 */
describe('which figures have creases that can go stale', () => {
  const ANGLED = doc([...SQUARE.slice(0, 4), line(0, 0, 1, 1, 'Red1', { fold_magnitude: 90 * 1e7 })]);

  it('sees a 3D figure drift, exactly as it sees a flat one', () => {
    const spatial = figureFrom(doc(SQUARE), SQUARE_IDS, { sourceKind: 'generated-3d' });
    expect(isFoldedFigureStale(doc(SQUARE), spatial)).toBe(false);
    expect(isFoldedFigureStale(ANGLED, spatial)).toBe(true);
  });

  it('leaves an imported or unrecognised figure alone', () => {
    // Neither has live creases behind it, so a drift it cannot act on is not
    // worth reporting — and `'unknown'` is what the reader writes for a kind a
    // newer build invented, where offering a refold would guess.
    for (const sourceKind of ['imported-folded-form', 'imported-preserved-frame', 'unknown'] as const) {
      const figure = figureFrom(doc(SQUARE), SQUARE_IDS, { sourceKind });
      expect(isFoldedFigureStale(ANGLED, figure), sourceKind).toBe(false);
    }
  });
});

describe('isFoldedFigureStale caching', () => {
  /** A document that counts how many times its line table is walked. */
  function countingDoc(lines: OristudioCpLineSegment[]) {
    const document = doc(lines);
    let reads = 0;
    Object.defineProperty(document.crease_pattern, 'line_segments', {
      get() {
        reads += 1;
        return lines;
      },
    });
    return { document, reads: () => reads };
  }

  it('walks the document once for a region, however many times it is asked', () => {
    // The regression this exists for: reopening a file with inline 3D figures
    // adopts them one at a time, and each adoption rewrites the figures array,
    // which invalidated the `useMemo` that asks this. Nothing this function
    // reads had changed, so 64 figures were re-tested 64 times — 67 ms a go on
    // a 15,950-segment document, 43% of frames dropped for the whole load.
    const figure = figureFrom(doc(SQUARE), SQUARE_IDS);
    const { document, reads } = countingDoc(SQUARE);

    expect(isFoldedFigureStale(document, figure)).toBe(false);
    const afterFirst = reads();
    expect(afterFirst).toBeGreaterThan(0);

    for (let i = 0; i < 63; i += 1) {
      expect(isFoldedFigureStale(document, figure)).toBe(false);
    }
    expect(reads()).toBe(afterFirst);
  });

  it('recomputes for the next document, so an edit is never missed', () => {
    // The cache's whole risk. Keyed on the snapshot object, which is decoded
    // fresh per edit — the same key the calling memo already used.
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    expect(isFoldedFigureStale(document, figure)).toBe(false);

    const edited = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.2, 'Blue2')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(true);
    // ...and the original is still answered correctly afterwards.
    expect(isFoldedFigureStale(document, figure)).toBe(false);
  });

  it('keys on the region, so two figures over one document cannot swap answers', () => {
    const document = doc([...SQUARE, line(5, 5, 6, 6, 'Red1')]);
    const whole = figureFrom(document, [1, 2, 3, 4, 5, 6]);
    const far = figureFrom(document, [6]);
    expect(isFoldedFigureStale(document, whole)).toBe(false);
    expect(isFoldedFigureStale(document, far)).toBe(false);

    // `far`'s region does not hash to `whole`'s, and a cache that ignored the
    // region would report this fresh.
    expect(isFoldedFigureStale(document, { ...far, sourceFingerprint: whole.sourceFingerprint })).toBe(
      true
    );
  });
});

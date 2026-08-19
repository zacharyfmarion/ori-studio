import { describe, expect, it } from 'vitest';
import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import { emptyOristudioCpSelection, type OristudioCpSelection } from './creasePatternViewport';
import { resolveSelectedSegment } from './creasePatternSelectionSegment';

// Two bordered squares side by side, sharing a middle border wall, each split by
// one diagonal crease:
//
//   3───8(M)──4───9(V)──5      vertices: 0:(0,0) 1:(1,0) 2:(2,0)
//   │  ╲   L  │  R   ╱  │                 3:(0,1) 4:(1,1) 5:(2,1)
//   │    ╲    │7(B) ╱   │      L = faces {0,1}, R = faces {2,3}
//   0────────1────────2       the middle wall (edge 1-4) is a border of BOTH.
//
// line_segments are laid out in the same order as edges, so line id === edge
// index + 1.
const LINES: Array<[number, number, number, number, string]> = [
  [0, 0, 1, 0, 'Black0'], // id 1  top-left border
  [1, 0, 2, 0, 'Black0'], // id 2  top-right border
  [0, 0, 0, 1, 'Black0'], // id 3  left border
  [2, 0, 2, 1, 'Black0'], // id 4  right border
  [0, 1, 1, 1, 'Black0'], // id 5  bottom-left border
  [1, 1, 2, 1, 'Black0'], // id 6  bottom-right border
  [1, 0, 1, 1, 'Black0'], // id 7  middle wall (shared border)
  [0, 0, 1, 1, 'Red1'], //   id 8  left diagonal crease (M)
  [1, 0, 2, 1, 'Blue2'], //  id 9  right diagonal crease (V)
];

const LEFT_LINE_IDS = [1, 3, 5, 7, 8];
const RIGHT_LINE_IDS = [2, 4, 6, 7, 9];

function makeFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [0, 3],
      [2, 5],
      [3, 4],
      [4, 5],
      [1, 4],
      [0, 4],
      [1, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'M', 'V'],
    faces_vertices: [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
    ],
  };
}

function makeArtifacts(fold: FoldDocument = makeFold()): FoldArtifacts {
  // No simulation_model → simulationFoldOf() returns `fold`; no `segments` →
  // resolveCpSegments computes segmentFoldDocument(fold), exercising the real path.
  return { fold, simulation_model: null };
}

function makeLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string,
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: '',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  };
}

function makeDocument(
  lines: Array<[number, number, number, number, string]> = LINES,
): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: {
      line_segments: lines.map((line) => makeLine(...line)),
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: {} as OristudioCpDocumentSnapshot['crease_pattern']['grid'],
    },
    metadata: {},
  };
}

function selection(
  lines: number[],
  extra: Partial<OristudioCpSelection> = {},
): OristudioCpSelection {
  return { ...emptyOristudioCpSelection(), lines, ...extra };
}

describe('resolveSelectedSegment', () => {
  it('matches the left region when exactly its creases (incl. borders) are selected', () => {
    const match = resolveSelectedSegment(makeDocument(), selection(LEFT_LINE_IDS), makeArtifacts());
    expect(match).not.toBeNull();
    expect(match?.segmentId).toBe(0);
    expect(match?.cpLineIds).toEqual(LEFT_LINE_IDS);
  });

  it('matches the right region and reports its own line set', () => {
    const match = resolveSelectedSegment(
      makeDocument(),
      selection(RIGHT_LINE_IDS),
      makeArtifacts(),
    );
    expect(match).not.toBeNull();
    expect(match?.segmentId).toBe(1);
    expect(match?.cpLineIds).toEqual(RIGHT_LINE_IDS);
  });

  it('is order-independent in the selection', () => {
    const shuffled = [8, 7, 5, 3, 1];
    const match = resolveSelectedSegment(makeDocument(), selection(shuffled), makeArtifacts());
    expect(match?.segmentId).toBe(0);
  });

  it('ignores non-line selections (a stray point does not block the match)', () => {
    const match = resolveSelectedSegment(
      makeDocument(),
      selection(LEFT_LINE_IDS, { points: [2] }),
      makeArtifacts(),
    );
    expect(match?.segmentId).toBe(0);
  });

  it('rejects an interior-only / partial selection', () => {
    expect(resolveSelectedSegment(makeDocument(), selection([7, 8]), makeArtifacts())).toBeNull();
  });

  it('rejects a selection that spills beyond one region', () => {
    expect(
      resolveSelectedSegment(makeDocument(), selection([...LEFT_LINE_IDS, 2]), makeArtifacts()),
    ).toBeNull();
  });

  it('rejects a selection spanning both regions', () => {
    expect(
      resolveSelectedSegment(
        makeDocument(),
        selection([...LEFT_LINE_IDS, ...RIGHT_LINE_IDS]),
        makeArtifacts(),
      ),
    ).toBeNull();
  });

  it('returns null for empty selection, missing document, or missing artifacts', () => {
    expect(resolveSelectedSegment(makeDocument(), selection([]), makeArtifacts())).toBeNull();
    expect(resolveSelectedSegment(null, selection(LEFT_LINE_IDS), makeArtifacts())).toBeNull();
    expect(resolveSelectedSegment(makeDocument(), selection(LEFT_LINE_IDS), null)).toBeNull();
  });

  it('includes a crease that lies inside the region but bounds no face', () => {
    // Real documents leave a slice of creases attributed to no face at all (face
    // inference is imperfect). They are plainly inside the region on screen, so
    // they belong to it and must be part of the expected set — otherwise
    // selecting the region could never match.
    const withOrphan: Array<[number, number, number, number, string]> = [
      ...LINES,
      [0.2, 0.5, 0.3, 0.5, 'Red1'], // id 10: floats inside the left square
    ];
    const doc = makeDocument(withOrphan);
    // The fold is unchanged, so this crease is in no face's edge list.
    expect(resolveSelectedSegment(doc, selection(LEFT_LINE_IDS), makeArtifacts())).toBeNull();
    const match = resolveSelectedSegment(doc, selection([...LEFT_LINE_IDS, 10]), makeArtifacts());
    expect(match?.segmentId).toBe(0);
    expect(match?.cpLineIds).toEqual([...LEFT_LINE_IDS, 10]);
  });

  it('rejects a region whose rim is not entirely border creases', () => {
    // Same single square, but one rim edge is a mountain crease: not a
    // self-contained crease pattern, so it is not offered.
    const fold: FoldDocument = {
      vertices_coords: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      edges_vertices: [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 3],
        [0, 3],
      ],
      edges_assignment: ['B', 'B', 'B', 'M', 'M'],
      faces_vertices: [
        [0, 1, 3],
        [0, 3, 2],
      ],
    };
    const doc = makeDocument([
      [0, 0, 1, 0, 'Black0'],
      [0, 0, 0, 1, 'Black0'],
      [1, 0, 1, 1, 'Black0'],
      [0, 1, 1, 1, 'Red1'],
      [0, 0, 1, 1, 'Red1'],
    ]);
    expect(resolveSelectedSegment(doc, selection([1, 2, 3, 4, 5]), makeArtifacts(fold))).toBeNull();
  });

  it('treats a single whole-sheet region as a matchable segment', () => {
    // One square, four borders + one diagonal crease → a single segment whose
    // complete crease set (all 5 lines) triggers a match.
    const fold: FoldDocument = {
      vertices_coords: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      edges_vertices: [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 3],
        [0, 3],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'M'],
      faces_vertices: [
        [0, 1, 3],
        [0, 3, 2],
      ],
    };
    const doc = makeDocument([
      [0, 0, 1, 0, 'Black0'],
      [0, 0, 0, 1, 'Black0'],
      [1, 0, 1, 1, 'Black0'],
      [0, 1, 1, 1, 'Black0'],
      [0, 0, 1, 1, 'Red1'],
    ]);
    const match = resolveSelectedSegment(doc, selection([1, 2, 3, 4, 5]), makeArtifacts(fold));
    expect(match?.segmentId).toBe(0);
    expect(match?.cpLineIds).toEqual([1, 2, 3, 4, 5]);
  });
});

import { describe, expect, it } from 'vitest';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import {
  creaseSegments,
  foldedPaneFrame,
  foldedPaneLines,
  foldedPaneToUser,
  foldedPivot,
  PANE_USER_PER_UNIT,
  paneFacesOf,
  paneTurnDeg,
  patternPaneFrame,
  patternPaneLines,
  ringsBounds,
  restackedScene,
  ringArea,
  ringCentroid,
  ringInterior,
  stackDepth,
  topFaces,
  XRAY_COVER,
  xrayFaceAlpha,
} from './layerPaneFigure';
import { zScene } from './layerPanes.fixtures';

describe('X-ray', () => {
  it('shares the cover out over the deepest stack: its layers compose to 60%', () => {
    for (const depth of [1, 2, 3, 7, 40]) {
      const alpha = xrayFaceAlpha(depth);
      expect(1 - (1 - alpha) ** depth).toBeCloseTo(XRAY_COVER, 12);
    }
    expect(xrayFaceAlpha(1)).toBeCloseTo(0.6);
    expect(xrayFaceAlpha(2)).toBeCloseTo(1 - Math.sqrt(0.4));
    // A figure of no spots draws as one layer would.
    expect(xrayFaceAlpha(0)).toBeCloseTo(0.6);
  });

  it('reads the depth off the deepest spot', () => {
    expect(stackDepth(zScene())).toBe(3);
  });
});

describe('the figure’s faces on the crease pattern', () => {
  it('rings each face by its outline’s points on the sheet, the same from either side', () => {
    const front = paneFacesOf(zScene('front'));
    const back = paneFacesOf(zScene('back'));
    expect(front.pattern[1]).toEqual([
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 10 },
    ]);
    expect(back.pattern).toEqual(front.pattern);
    expect(front.patternCentroids).toEqual([
      { x: 10, y: 5 },
      { x: 25, y: 5 },
      { x: 35, y: 5 },
    ]);
  });

  it('puts a letter inside a ring whose centroid is not: a frame, or an L', () => {
    const frame = [
      // Round the outside, then back round the window, joined by a slit at the bottom.
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 3, y: 7 },
      { x: 7, y: 7 },
      { x: 7, y: 3 },
      { x: 3, y: 3 },
    ];
    const at = ringInterior(frame)!;
    expect(at.y).toBe(5);
    expect(at.x).toBeCloseTo(1.5);
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(ringInterior(square)).toEqual({ x: 2, y: 2 });
    expect(ringInterior([])).toBeNull();
  });

  it('measures rings either way round', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(ringArea(square)).toBe(4);
    expect(ringArea([...square].reverse())).toBe(4);
    expect(ringCentroid([...square].reverse())).toEqual({ x: 1, y: 1 });
    expect(ringCentroid([])).toBeNull();
  });
});

describe('the order on screen', () => {
  it('restacks a scene’s spots, and leaves it be with no stacks or stacks for other spots', () => {
    const scene = zScene();
    const stacks = { offsets: new Uint32Array([0, 1, 4]), faces: new Uint32Array([0, 1, 0, 2]) };
    const restacked = restackedScene(scene, stacks);
    expect(topFaces(restacked)).toEqual([0, 1]);
    expect(restacked.subfaces[1]!.faces_top_to_bottom).toEqual([1, 0, 2]);
    expect(restacked.subfaces[1]!.polygon).toBe(scene.subfaces[1]!.polygon);
    // The same stacks, the same scene.
    expect(restackedScene(scene, stacks)).toBe(restacked);
    expect(restackedScene(scene, null)).toBe(scene);
    expect(restackedScene(scene, { offsets: new Uint32Array([0, 1]), faces: new Uint32Array([0]) })).toBe(scene);
  });

  it('draws the lines of the faces that show, and every face’s under X-ray, their aux lines with them', () => {
    // Face 1 is on top of no spot: the paper draws neither its outline nor its aux line until X-ray.
    const scene: OristudioCpFoldedPaperScene = {
      ...zScene(),
      aux_lines: [
        { from: { x: 1, y: 1 }, to: { x: 9, y: 9 }, face: 0 },
        { from: { x: 11, y: 1 }, to: { x: 19, y: 9 }, face: 1 },
      ],
    };
    const ends = (segments: ReturnType<typeof foldedPaneLines>) => segments.map(([a, b]) => `${a.x},${a.y}-${b.x},${b.y}`);
    const sides = (face: number) =>
      scene.faces[face]!.outline.map((from, i, ring) => `${from.x},${from.y}-${ring[(i + 1) % ring.length]!.x},${ring[(i + 1) % ring.length]!.y}`);
    expect(ends(foldedPaneLines(scene, false, true))).toEqual([...sides(0), ...sides(2), '1,1-9,9']);
    expect(ends(foldedPaneLines(scene, true, true))).toEqual([...sides(0), ...sides(1), ...sides(2), '1,1-9,9', '11,1-19,9']);
    // The order on screen decides what shows.
    const turned = restackedScene(scene, { offsets: new Uint32Array([0, 1, 4]), faces: new Uint32Array([0, 1, 2, 0]) });
    expect(ends(foldedPaneLines(turned, false, true))).toEqual([...sides(0), ...sides(1), '1,1-9,9', '11,1-19,9']);
  });

  it('leaves out the lines the paper draws in the aux pen when the style leaves that pen out', () => {
    // Face 0's first edge is a flat crease: the paper draws it in the aux pen, as it does the aux lines.
    const base = zScene();
    const flat = base.faces[0]!.edges.map((edge, i) => (i === 0 ? { ...edge, kind: 'flat' as const } : edge));
    const scene: OristudioCpFoldedPaperScene = {
      ...base,
      faces: base.faces.map((face, k) => (k === 0 ? { ...face, edges: flat } : face)),
      aux_lines: [{ from: { x: 1, y: 1 }, to: { x: 9, y: 9 }, face: 0 }],
    };
    const count = (aux: boolean) => foldedPaneLines(scene, true, aux).length;
    expect(count(true)).toBe(12 + 1);
    // Without the aux pen: neither the aux line nor the flat edge.
    expect(count(false)).toBe(12 - 1);
    const kept = foldedPaneLines(scene, true, false).map(([a, b]) => `${a.x},${a.y}-${b.x},${b.y}`);
    const [from, to] = [scene.faces[0]!.outline[0]!, scene.faces[0]!.outline[1]!];
    expect(kept).not.toContain(`${from.x},${from.y}-${to.x},${to.y}`);
  });
});

describe('the frames', () => {
  it('draws the crease pattern where Edit does, and the folded paper at Edit’s scale', () => {
    expect(PANE_USER_PER_UNIT).toBeCloseTo(588 / 400);
    const unturned = foldedPaneToUser(0, { x: 7, y: 3 });
    expect(unturned({ x: 12, y: -40 })).toEqual(cpModelToSvg({ x: 12, y: -40 }));
  });

  it('turns the folded paper clockwise about its middle, by the host’s turn', () => {
    const pivot = foldedPivot(zScene());
    expect(pivot).toEqual({ x: 10, y: 5 });
    const quarter = foldedPaneToUser(90, pivot);
    const middle = cpModelToSvg(pivot);
    // On a y-down page, a quarter turn clockwise takes +x to +y.
    const right = quarter({ x: 20, y: 5 });
    expect(right.x).toBeCloseTo(middle.x);
    expect(right.y).toBeCloseTo(middle.y + 10 * PANE_USER_PER_UNIT);
    expect(quarter(pivot)).toEqual(middle);
  });

  it('turns the other way seen from the other side, as a turned-over step does', () => {
    expect(paneTurnDeg(30, 'front', 'front')).toBe(30);
    expect(paneTurnDeg(30, 'front', 'back')).toBe(330);
    expect(paneTurnDeg(30, 'back', 'back')).toBe(30);
    expect(paneTurnDeg(-90, 'front', 'front')).toBe(270);
    expect(paneTurnDeg(0, 'front', 'back')).toBe(0);
  });
});

describe('the crease pattern’s lines', () => {
  const line = (color: string, x: number): OristudioCpLineSegment => ({
    a: { x, y: 0 },
    b: { x, y: 10 },
    active: 'INACTIVE_0',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  });
  const source: LayerOrderSource = {
    segments: [line('Black0', 0), line('Red1', 1), line('Blue2', 2), line('Black0', 3)],
    startingFaceId: 1,
    auxSegments: [line('Cyan3', 4)],
    model: DEFAULT_FOLDED_MODEL,
    digest: '0',
  };

  it('in painter’s order: auxiliary lines, creases, then the edge', () => {
    expect(patternPaneLines(source).map(({ color, a }) => `${color}@${a.x}`)).toEqual([
      'Cyan3@4',
      'Red1@1',
      'Blue2@2',
      'Black0@0',
      'Black0@3',
    ]);
  });

  it('with a region, its sheet’s aux lines in place of the whole document’s', () => {
    const document = { ...source, auxSegments: [line('Cyan3', 4), line('Cyan3', 900)] };
    const region = { paper: [], auxSegments: [line('Cyan3', 5)] };
    expect(patternPaneLines(document, region).map(({ color, a }) => `${color}@${a.x}`)).toEqual([
      'Cyan3@5',
      'Red1@1',
      'Blue2@2',
      'Black0@0',
      'Black0@3',
    ]);
  });
});

describe('Fit: each pane its own content', () => {
  const user = (x: number, y: number) => cpModelToSvg({ x, y });
  const boxOf = (from: { x: number; y: number }, to: { x: number; y: number }) => ({
    minX: Math.min(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxX: Math.max(from.x, to.x),
    maxY: Math.max(from.y, to.y),
  });
  const segment = (color: string, ax: number, ay: number, bx: number, by: number): OristudioCpLineSegment => ({
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: 'INACTIVE_0',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  });
  // The Z's strip, 40 by 10, one pattern of a document whose aux lines run on across another, far off.
  const strip: LayerOrderSource = {
    segments: [
      segment('Black0', 0, 0, 40, 0),
      segment('Black0', 40, 0, 40, 10),
      segment('Black0', 40, 10, 0, 10),
      segment('Black0', 0, 10, 0, 0),
      segment('Blue2', 20, 0, 20, 10),
      segment('Red1', 30, 0, 30, 10),
    ],
    startingFaceId: 0,
    auxSegments: [segment('Cyan3', 0, 5, 40, 5), segment('Cyan3', 900, 900, 960, 960)],
    model: DEFAULT_FOLDED_MODEL,
    digest: '0',
  };
  const paper = [
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 0, y: 10 },
    ],
  ];

  it('the crease pattern: its region’s paper, never the document’s other patterns', () => {
    const region = { paper, auxSegments: [strip.auxSegments[0]!] };
    expect(patternPaneFrame(strip, region)).toEqual(boxOf(user(0, 0), user(40, 10)));
  });

  it('the crease pattern with no region: the creases folded, not the aux lines', () => {
    expect(patternPaneFrame(strip)).toEqual(boxOf(user(0, 0), user(40, 10)));
    expect(patternPaneFrame({ ...strip, segments: [] })).toBeNull();
  });

  it('the folded figure: itself, from either side and at the host’s turn, however small it folds', () => {
    // The Z folds to 20 by 10, half its 40 sheet: the pane frames the 20, not the sheet.
    for (const side of ['front', 'back'] as const) {
      const scene = zScene(side);
      const flat = foldedPaneFrame(scene, foldedPaneToUser(0, foldedPivot(scene)))!;
      const outlines = ringsBounds(scene.faces.map((face) => face.outline), cpModelToSvg)!;
      for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(flat[key]).toBeCloseTo(outlines[key]);
      expect(flat.maxX - flat.minX).toBeCloseTo(20 * PANE_USER_PER_UNIT);
      expect(flat.maxY - flat.minY).toBeCloseTo(10 * PANE_USER_PER_UNIT);
      // A quarter turn stands it on end, about its own middle.
      const turned = foldedPaneFrame(scene, foldedPaneToUser(90, foldedPivot(scene)))!;
      expect(turned.maxX - turned.minX).toBeCloseTo(10 * PANE_USER_PER_UNIT);
      expect(turned.maxY - turned.minY).toBeCloseTo(20 * PANE_USER_PER_UNIT);
      expect((turned.minX + turned.maxX) / 2).toBeCloseTo((flat.minX + flat.maxX) / 2);
    }
  });
});

describe('the crease two faces meet at', () => {
  // A 20 by 10 strip folded in half at x = 10: face 1 (x 10–20) folds over face 0.
  const folded = (): OristudioCpFoldedPaperScene => {
    const sheet = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ];
    const face = (points: number[], outline: { x: number; y: number }[]) => ({
      outline,
      points,
      front_up: true,
      edges: [],
    });
    return {
      schema_version: 3,
      flipped: false,
      sheet: 20,
      faces: [
        face([0, 1, 2, 3], [sheet[0]!, sheet[1]!, sheet[2]!, sheet[3]!]),
        // Its far edge lands on x = 0; the crease stays at x = 10.
        face([1, 4, 5, 2], [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }]),
      ],
      subfaces: [],
      aux_lines: [],
      sheet_points: sheet,
    };
  };

  it('is the side both faces step along, on the crease pattern and on the folded paper', () => {
    expect(creaseSegments(folded(), [0, 1], 'pattern')).toEqual([[{ x: 10, y: 0 }, { x: 10, y: 10 }]]);
    // Read off the first face named, so along its own ring's way round.
    expect(creaseSegments(folded(), [1, 0], 'pattern')).toEqual([[{ x: 10, y: 10 }, { x: 10, y: 0 }]]);
    expect(creaseSegments(folded(), [0, 1], 'folded')).toEqual([[{ x: 10, y: 0 }, { x: 10, y: 10 }]]);
  });

  it('is nothing for faces that share no side, a face the scene lacks, or a scene that names no points', () => {
    // The Z fixture names each face's corners apart.
    expect(creaseSegments(zScene(), [0, 1], 'pattern')).toEqual([]);
    expect(creaseSegments(folded(), [0, 9], 'folded')).toEqual([]);
    const unnamed = folded();
    expect(creaseSegments({ ...unnamed, faces: unnamed.faces.map((f) => ({ ...f, points: [] })) }, [0, 1], 'pattern')).toEqual([]);
  });
});

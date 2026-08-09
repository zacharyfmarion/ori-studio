/**
 * The 3D projector, against real kernel payloads.
 *
 * Every fixture here is the kernel's own `Folded3dRenderModel`, emitted by
 * `cargo run -p oristudio-cp --release --example fold3d_render_model --
 * --out apps/web/src/cp-workspace/folded/__fixtures__`. Nothing is hand-written,
 * so a change in what the kernel emits shows up here rather than being absorbed
 * by a stand-in that agrees with the projector by construction.
 *
 * The automated browser pane runs with no animation frames, so a canvas cannot
 * be looked at. Everything the projector decides is decided in pure arithmetic
 * before a canvas is involved, which is what makes that acceptable rather than a
 * gap: the tests below assert the primitive stream itself.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BSP_ITEM_BUDGET,
  DEFAULT_FOLDED_3D_CAMERA,
  UNDETERMINED_FACE_ALPHA,
  antipodalCamera,
  defaultFolded3dCamera,
  folded3dBspItems,
  folded3dCoplanarEpsilon,
  folded3dEyeDirection,
  foldedFigureOtherSideCamera,
  foldedLineStroke,
  folded3dFrameRadius,
  projectFolded3dModel,
  undeterminedCellColor,
  type FoldedFigureCamera,
  type Folded3dPaperStyle,
  type Folded3dProjectionOptions,
} from './foldedFigure3dProjection';
import { foldedFigureBox, foldedFigureLocalGeometry } from '../adapters/cpFoldedToScene';
import {
  IDENTITY_FOLDED_PLACEMENT,
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_EDGE_ATTR_STRIDE,
  FOLDED_3D_CELL_UNDETERMINED,
  FOLDED_3D_PLANE_FRAME_STRIDE,
  type OristudioCpFold3dTolerances,
  type OristudioCpFolded3dRenderModel,
  type OristudioCpFoldedFigureEntry,
  type OristudioCpFoldedRenderPrimitive,
} from '../../engine/oristudioCpTypes';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture(name: string): OristudioCpFolded3dRenderModel {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8'));
}

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
const TOLERANCES: OristudioCpFold3dTolerances = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

const STYLE: Folded3dPaperStyle = {
  front: [1, 1, 0.2],
  back: [1, 1, 1],
  line: [0, 0, 0],
  faceAlpha: 1,
  transparentAlpha: 16 / 255,
  lineWidth: 1.200000048,
  antiAlias: true,
  lighting: true,
  lightDir: [0, 0, 1],
};

function options(overrides: Partial<Folded3dProjectionOptions> = {}): Folded3dProjectionOptions {
  return {
    camera: DEFAULT_FOLDED_3D_CAMERA,
    displayStyle: 'Paper5',
    style: STYLE,
    tolerances: TOLERANCES,
    ...overrides,
  };
}

/* --------------------------------------------------------------------------
 * Geometry helpers, so the assertions can talk about area rather than indices
 * ----------------------------------------------------------------------- */

function primitivePoints(primitive: OristudioCpFoldedRenderPrimitive): Array<[number, number]> {
  if (primitive.geometry.kind === 'polygon') {
    return primitive.geometry.points.map((point) => [point.x, point.y]);
  }
  if (primitive.geometry.kind !== 'path') return [];
  const points: Array<[number, number]> = [];
  for (const command of primitive.geometry.commands) {
    if (command.command === 'move_to' || command.command === 'line_to') {
      points.push([command.point.x, command.point.y]);
    }
  }
  return points;
}

function polygonArea(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function fills(primitives: readonly OristudioCpFoldedRenderPrimitive[]) {
  return primitives.filter((primitive) => primitive.kind === 'fill_path');
}

function strokes(primitives: readonly OristudioCpFoldedRenderPrimitive[]) {
  return primitives.filter((primitive) => primitive.kind === 'stroke_path');
}

function paintedArea(primitives: readonly OristudioCpFoldedRenderPrimitive[]): number {
  return fills(primitives).reduce(
    (total, primitive) => total + polygonArea(primitivePoints(primitive)),
    0
  );
}

function cellAttr(model: OristudioCpFolded3dRenderModel, cell: number, field: number): number {
  return model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + field] ?? 0;
}

function cellStack(model: OristudioCpFolded3dRenderModel, cell: number): number[] {
  const start = cellAttr(model, cell, 3);
  return model.cell_stack.slice(start, start + cellAttr(model, cell, 4));
}

/**
 * A cell's faces **far-to-near at this camera**, which is the order they have to
 * be painted in and whose last element is the one an opaque render shows.
 *
 * `cell_stack` is top-first with respect to the cell's plane `up`, and `up` is a
 * property of the *paper* — the placed normal of the plane's lowest-indexed
 * member face — so it points toward the viewer for some cameras and away for
 * others. Stated here rather than taken from the projector, because the whole
 * point is to check the projector against it.
 */
function cellFarToNear(
  model: OristudioCpFolded3dRenderModel,
  cell: number,
  camera: FoldedFigureCamera
): number[] {
  const stack = cellStack(model, cell);
  const base = cellAttr(model, cell, 0) * FOLDED_3D_PLANE_FRAME_STRIDE;
  const eye = folded3dEyeDirection(camera);
  const towardEye =
    (model.plane_frames[base] ?? 0) * eye[0] +
      (model.plane_frames[base + 1] ?? 0) * eye[1] +
      (model.plane_frames[base + 2] ?? 0) * eye[2] >=
    0;
  return towardEye ? [...stack].reverse() : [...stack];
}

/** Cells whose stack has more than one face — the only ones an order can be wrong for. */
function stackedCells(model: OristudioCpFolded3dRenderModel): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    if (cellStack(model, cell).length > 1) cells.push(cell);
  }
  return cells;
}

/** Cells the eye sees from the `-up` side, where `cell_stack` runs near-to-far. */
function cellsSeenFromBelow(
  model: OristudioCpFolded3dRenderModel,
  camera: FoldedFigureCamera
): number[] {
  return stackedCells(model).filter(
    (cell) => cellFarToNear(model, cell, camera)[0] === cellStack(model, cell)[0]
  );
}

/**
 * Total area painted per cell, keyed by cell.
 *
 * Cutting a polygon preserves area and stacking repeats it, so a cell's painted
 * area must be its ring area times the number of layers drawn — which is what
 * makes a dropped ear, a dropped piece or a dropped layer visible as a number
 * rather than as an index.
 */
function areaByCell(projection: {
  snapshot: { primitives: OristudioCpFoldedRenderPrimitive[] };
  cells: number[];
}): Map<number, number> {
  const byCell = new Map<number, number>();
  projection.snapshot.primitives.forEach((primitive, index) => {
    if (primitive.kind !== 'fill_path') return;
    const cell = projection.cells[index]!;
    byCell.set(cell, (byCell.get(cell) ?? 0) + polygonArea(primitivePoints(primitive)));
  });
  return byCell;
}

/* --------------------------------------------------------------------------
 * The contract
 * ----------------------------------------------------------------------- */

describe('projecting the 3D folded state', () => {
  it('is face-on and unmirrored at the identity camera', () => {
    // The chirality trap, pinned. `cpModelToSvg` does not flip y while the
    // kernel's rings are counter-clockwise in y-up paper coordinates, so a
    // projector that gets the sign wrong emits a mirrored figure with front and
    // back swapped — which looks entirely plausible.
    const model = fixture('hinge_90');
    const camera: FoldedFigureCamera = { yaw: 0, pitch: 0, zoom: 1 };
    const projection = projectFolded3dModel(
      model,
      options({ camera, cullHidden: false, mergeCoplanar: false })
    );

    // Every cell vertex, straight out of the payload, minus the model centroid.
    // Face-on means the projection is exactly `(x, y)` of the world — same sign,
    // same axis order, no rotation.
    const vertices = Math.floor(model.cell_points.length / 3);
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < vertices; i += 1) {
      cx += model.cell_points[i * 3]!;
      cy += model.cell_points[i * 3 + 1]!;
    }
    cx /= vertices;
    cy /= vertices;
    const expected = new Set<string>();
    const mirrored = new Set<string>();
    for (let i = 0; i < vertices; i += 1) {
      const x = model.cell_points[i * 3]! - cx;
      const y = model.cell_points[i * 3 + 1]! - cy;
      expected.add(`${x.toFixed(6)},${y.toFixed(6)}`);
      mirrored.add(`${x.toFixed(6)},${(-y).toFixed(6)}`);
    }

    const drawn = new Set(
      fills(projection.snapshot.primitives).flatMap((primitive) =>
        primitivePoints(primitive).map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`)
      )
    );
    expect(drawn.size).toBeGreaterThan(0);
    for (const point of drawn) expect(expected).toContain(point);
    for (const point of expected) expect(drawn).toContain(point);
    // Non-vacuous only because this figure is not symmetric about y: flipping
    // the sign would produce a different set, and the loop above would catch it.
    expect([...mirrored].sort()).not.toEqual([...expected].sort());
  });

  it('emits the whole stream for a two-face figure', () => {
    // The golden, at the camera a figure is actually folded at. Small enough to
    // read: two triangles at 90 degrees, one cell each, five arrangement edges,
    // both faces visible and differently shaded because they are in different
    // planes. Regenerate the payload with the example named at the top of this
    // file if the kernel's output changes.
    const projection = projectFolded3dModel(fixture('hinge_90'), options());
    const stream = projection.snapshot.primitives.map((primitive) => ({
      sequence: primitive.sequence,
      kind: primitive.kind,
      color:
        primitive.style.paint.kind === 'color'
          ? [
              primitive.style.paint.color.red,
              primitive.style.paint.color.green,
              primitive.style.paint.color.blue,
              primitive.style.paint.color.alpha,
            ]
          : null,
      points: primitivePoints(primitive).map(([x, y]) => [round(x), round(y)]),
    }));
    expect(stream).toMatchSnapshot();
    expect(projection.order).toBe('bsp');
  });

  it('does not draw the creases of layers buried under opaque paper', () => {
    // The bug this pins: inside a coplanar stack no piece is *in front of*
    // another, so `findVisiblePieces` cannot cull any of them and correctly does
    // not. Fills escape it because one slot per cell is taken separately — but
    // that selection was never applied to strokes, so every buried layer's
    // creases drew over the one visible fill and the figure read as see-through.
    // Measured on the model that reported it, `plant_penguin.osf` (136 of its 206
    // creases are +/-180, so most of it is one flat stack): 79 strokes against 56
    // visible fills, dropping to 30 once buried creases go.
    const model = fixture('spikes_small');
    // Derived from the payload rather than from the projector, so this is a
    // second opinion and not a restatement: a crease is buried when *neither*
    // incident face is the layer its cell shows.
    const shown = new Set<number>();
    for (let cell = 0; cell < model.cell_count; cell += 1) {
      const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
      const start = model.cell_attr[base + 3]!;
      const stack = model.cell_stack.slice(start, start + model.cell_attr[base + 4]!);
      // Both ends: which one the camera shows is the projector's business, and
      // taking both keeps this test camera-agnostic and conservative — it can
      // only under-count what is buriable, never over-count.
      if (stack.length > 0) shown.add(stack[stack.length - 1]!).add(stack[0]!);
    }
    const buriable = [...Array(model.edge_count).keys()].filter((edge) => {
      const a = model.edge_attr[edge * FOLDED_3D_EDGE_ATTR_STRIDE]!;
      const b = model.edge_attr[edge * FOLDED_3D_EDGE_ATTR_STRIDE + 1]!;
      return (a < 0 || !shown.has(a)) && (b < 0 || !shown.has(b));
    });
    // Non-vacuous: the fixture must actually have creases that can be buried,
    // or this passes against a projector that buries nothing.
    expect(buriable.length).toBeGreaterThan(0);

    // The count, because it is the thing that changed: 26 strokes before the
    // burial test existed, 20 after. A bound rather than a count passes either
    // way — `findVisiblePieces` already removes enough on its own to satisfy any
    // inequality worth writing — so this is pinned exactly, and a projector that
    // stops burying creases fails here rather than quietly going back to 26.
    const drawn = strokes(projectFolded3dModel(model, options()).snapshot.primitives).length;
    expect(drawn).toBe(20);
  });

  it('draws every crease and every cell', () => {
    const model = fixture('box_90');
    const projection = projectFolded3dModel(model, options({ cullHidden: false }));
    expect(strokes(projection.snapshot.primitives).length).toBeGreaterThanOrEqual(model.edge_count);
    expect(fills(projection.snapshot.primitives).length).toBeGreaterThanOrEqual(model.cell_count);
  });

  it('keeps the stroke the flat figure uses', () => {
    // `folded_line_stroke` in `crates/oristudio-cp/src/folding.rs`, pinned on the
    // Rust side by the committed render-primitive fixture in
    // `crates/oristudio-cp/tests/folding.rs`. Both consumers of this field fall
    // back to a width of 1 for any stroke that is not `basic`, so getting it
    // wrong is silent.
    expect(foldedLineStroke(true)).toEqual({
      kind: 'basic',
      width: 1.200000048,
      end_cap: 0,
      line_join: 0,
      miter_limit: 10,
    });
    expect(foldedLineStroke(false).kind).toBe('basic');
    const projection = projectFolded3dModel(fixture('hinge_90'), options());
    for (const primitive of projection.snapshot.primitives) {
      expect(primitive.style.stroke).toEqual(foldedLineStroke(true));
    }
  });
});

describe('the layer order the kernel computed', () => {
  // Both cameras, on every layer-order assertion. `cell_stack` is top-first with
  // respect to the *paper's* `up`, so at a camera on the other side of a plane
  // the near layer is the last element rather than the first — and a projector
  // that ignores the eye draws the layer furthest from the viewer, with the
  // wrong paper side and the wrong shading, which is a clean picture of the
  // wrong thing. Only the antipodal case can catch it: the committed fixtures
  // happen to sit `up`-toward-the-eye at the default camera, which is a property
  // of the fixtures and not a theorem.
  const CAMERAS: Array<[string, FoldedFigureCamera]> = [
    ['the default camera', DEFAULT_FOLDED_3D_CAMERA],
    ['the antipodal camera', antipodalCamera(DEFAULT_FOLDED_3D_CAMERA)],
  ];

  it('sees at least one fixture stack from the far side, so the cameras differ', () => {
    // Non-vacuity for the two tests below: without a cell whose plane `up` faces
    // away, both cameras assert the same thing and neither catches the bug.
    const back = antipodalCamera(DEFAULT_FOLDED_3D_CAMERA);
    for (const name of ['box_90', 'pinwheel_cyclic', 'spikes_small', 'strip_coupled']) {
      const model = fixture(name);
      expect(stackedCells(model).length).toBeGreaterThan(0);
      expect(cellsSeenFromBelow(model, DEFAULT_FOLDED_3D_CAMERA)).toHaveLength(0);
      expect(cellsSeenFromBelow(model, back)).toEqual(stackedCells(model));
    }
  });

  it.each(CAMERAS)('draws each cell’s near layer last, per cell, at %s', (_name, camera) => {
    // The regression a "just sort it" refactor has to fail. Stated per cell,
    // because there is no global order to state it against.
    const model = fixture('pinwheel_cyclic');
    const projection = projectFolded3dModel(
      model,
      options({ camera, displayStyle: 'Transparent3', cullHidden: false, mergeCoplanar: false })
    );
    expect(model.cell_count).toBeGreaterThan(0);

    // Every slot of every cell is emitted far-to-near, so each run of a cell's
    // fills ends on the layer nearest the eye.
    const runs = new Map<number, number[][]>();
    projection.snapshot.primitives.forEach((primitive, index) => {
      if (primitive.kind !== 'fill_path') return;
      const cell = projection.cells[index]!;
      const list = runs.get(cell) ?? [];
      const stackLength = cellStack(model, cell).length;
      const last = list[list.length - 1];
      if (!last || last.length === stackLength) list.push([projection.faces[index]!]);
      else last.push(projection.faces[index]!);
      runs.set(cell, list);
    });
    expect(runs.size).toBe(model.cell_count);
    for (const [cell, pieces] of runs) {
      const farToNear = cellFarToNear(model, cell, camera);
      for (const piece of pieces) {
        expect(piece).toEqual(farToNear);
        expect(piece[piece.length - 1]).toBe(farToNear[farToNear.length - 1]);
      }
    }
  });

  it.each(CAMERAS)('draws only the near layer when the paper is opaque, at %s', (_name, camera) => {
    // Every face of a cell covers the whole cell — that is what a cell is — so
    // an opaque render shows exactly one of them, and it is the one the viewer
    // is on the side of.
    const model = fixture('pinwheel_cyclic');
    const projection = projectFolded3dModel(
      model,
      options({ camera, cullHidden: false, mergeCoplanar: false })
    );
    let checked = 0;
    projection.snapshot.primitives.forEach((primitive, index) => {
      if (primitive.kind !== 'fill_path') return;
      const cell = projection.cells[index]!;
      const farToNear = cellFarToNear(model, cell, camera);
      expect(projection.faces[index]).toBe(farToNear[farToNear.length - 1]);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('hands the kernel’s intra-plane draw order to the tree', () => {
    // `draw_rank` is the kernel's tie-break for cells of one plane: normally
    // area-disjoint and so deciding nothing, but where a decomposition slips a
    // containment through it puts the contained cell on top. The tree destroys
    // array order among coplanar items — every candidate splitter is promoted to
    // the head of its own list — so the rank has to travel on the item.
    //
    // Asserted where it is decidable, which is on the items. It is *not*
    // decidable from the emitted stream: a cell cut by another plane has its
    // pieces spread across subtrees, so the order two cells of one plane come
    // out in is settled by real geometry wherever they are not in one coplanar
    // list, and `sortCoplanar` only ever governs the case where they are.
    for (const name of ['box_90', 'spikes_small', 'pinwheel_cyclic']) {
      const model = fixture(name);
      const items = folded3dBspItems(model, 'Paper5');
      const faces = items.filter((item) => item.kind === 0);
      const edges = items.filter((item) => item.kind === 1);
      expect(faces.length).toBeGreaterThanOrEqual(model.cell_count);
      expect(edges).toHaveLength(model.edge_count);
      for (const item of faces) {
        expect(item.ref).toBeLessThan(model.cell_count);
        expect(item.order).toBe(cellAttr(model, item.ref, 6));
      }
      // One triangle per ear, for every cell: `ring_len - 2`.
      let expectedTriangles = 0;
      for (let cell = 0; cell < model.cell_count; cell += 1) {
        expectedTriangles += cellAttr(model, cell, 2) - 2;
      }
      expect(faces).toHaveLength(expectedTriangles);
    }
  });

  it('survives a cyclic panel order', () => {
    // Solution 5 of the pinwheel orders its four arms `0 > 4 > 3 > 2 > 0`. The
    // fixture is asserted to be cyclic here rather than assumed, because the
    // point of the test is lost the moment it stops being.
    const model = fixture('pinwheel_cyclic');
    const relations: Array<[number, number]> = [];
    for (let cell = 0; cell < model.cell_count; cell += 1) {
      const stack = cellStack(model, cell);
      for (let i = 0; i < stack.length; i += 1) {
        for (let j = i + 1; j < stack.length; j += 1) relations.push([stack[i]!, stack[j]!]);
      }
    }
    expect(hasCycle(relations, model.face_count)).toBe(true);

    // No throw, nothing dropped: the projector never asks for a global order.
    const projection = projectFolded3dModel(
      model,
      options({ cullHidden: false, mergeCoplanar: false })
    );
    expect(fills(projection.snapshot.primitives).length).toBeGreaterThanOrEqual(model.cell_count);
  });

  it('shows a reordering under the paper only where the paper is see-through', () => {
    // Why a 3D figure has to be offered `Transparent3`, stated as arithmetic.
    // Swapping two *buried* layers of a stack is invisible under opaque paper —
    // every face of a cell covers the whole cell, so only the near one is drawn
    // — which is exactly what made "Another solution" read as a dead button:
    // measured on `penguin_freeform`, all eight solutions render byte-identical
    // under `Paper5` and again under `Wire2`, and only `Transparent3` tells any
    // of them apart.
    const model = fixture('pinwheel');
    const cell = stackedCells(model).find((candidate) => {
      const stack = cellStack(model, candidate);
      if (stack.length < 3) return false;
      // Two buried faces on opposite sides of the paper, so swapping them
      // changes a colour and not merely an index.
      return (model.face_normals[stack[1]! * 3 + 2] ?? 0) * (model.face_normals[stack[2]! * 3 + 2] ?? 0) < 0;
    });
    if (cell === undefined) throw new Error('expected a three-deep stack with a two-sided pair');

    const start = cellAttr(model, cell, 3);
    const swapped = [...model.cell_stack];
    swapped[start + 1] = model.cell_stack[start + 2]!;
    swapped[start + 2] = model.cell_stack[start + 1]!;
    const reordered: OristudioCpFolded3dRenderModel = { ...model, cell_stack: swapped };
    // The near layer is untouched; only what is under it moved.
    expect(cellStack(reordered, cell)[0]).toBe(cellStack(model, cell)[0]);
    expect(cellStack(reordered, cell)).not.toEqual(cellStack(model, cell));

    const picture = (
      subject: OristudioCpFolded3dRenderModel,
      displayStyle: 'Paper5' | 'Transparent3'
    ) =>
      JSON.stringify(
        projectFolded3dModel(
          subject,
          options({ displayStyle, cullHidden: false, mergeCoplanar: false })
        ).snapshot
      );

    expect(picture(reordered, 'Paper5')).toEqual(picture(model, 'Paper5'));
    expect(picture(reordered, 'Transparent3')).not.toEqual(picture(model, 'Transparent3'));
  });

  it('draws a different picture for a different solution', () => {
    // Solutions 1 and 5 of the same pinwheel: identical geometry, different
    // stacking. If the projector drew the paper rather than the order, "another
    // solution" would change nothing a user can see.
    const first = fixture('pinwheel');
    const fifth = fixture('pinwheel_cyclic');
    // Same paper, same placement — only the stacking differs. (`cell_points`
    // is not compared: cells are ordered by area then lowest stacked face, so a
    // different stack can reorder the cell list without moving any paper.)
    expect(fifth.ring_points).toEqual(first.ring_points);
    expect(fifth.face_normals).toEqual(first.face_normals);
    expect(fifth.cell_stack).not.toEqual(first.cell_stack);
    const stream = (model: OristudioCpFolded3dRenderModel) =>
      projectFolded3dModel(model, options({ cullHidden: false, mergeCoplanar: false }))
        .faces.join(',');
    expect(stream(fifth)).not.toEqual(stream(first));
  });

  it('interleaves two planes whose ordering is coupled', () => {
    // The 1x4 strip at (-90, +180, +90): creases 1 and 3 land on one 3D line
    // while their faces sit in two planes, so per-plane depth resolution is
    // definite and wrong half the time. Turning the camera around must reverse
    // which plane is drawn last.
    const model = fixture('strip_coupled');
    expect(model.plane_count).toBe(2);
    const camera: FoldedFigureCamera = { yaw: 0, pitch: 0.6, zoom: 1 };
    const front = planeOrder(model, camera);
    const back = planeOrder(model, antipodalCamera(camera));
    expect(front).not.toEqual(back);
    expect([...front].reverse()).toEqual(back);
  });
});

describe('X-ray transparency', () => {
  it('takes its alpha from the model, not from a constant of ours', () => {
    // Oriedita uses `transparent_transparency` directly as the fill alpha and
    // defaults it to 16/255 — faint on purpose, because the picture is built
    // from where layers stack rather than from one layer reading well.
    const faint = projectFolded3dModel(
      fixture('spikes_small'),
      options({ displayStyle: 'Transparent3', style: { ...STYLE, transparentAlpha: 16 / 255 } })
    );
    const strong = projectFolded3dModel(
      fixture('spikes_small'),
      options({ displayStyle: 'Transparent3', style: { ...STYLE, transparentAlpha: 200 / 255 } })
    );
    const alphaOf = (projection: { snapshot: { primitives: OristudioCpFoldedRenderPrimitive[] } }) =>
      fills(projection.snapshot.primitives)
        .map((primitive) =>
          primitive.style.paint.kind === 'color' ? primitive.style.paint.color.alpha : -1
        )
        .find((alpha) => alpha >= 0);
    expect(alphaOf(faint)).toBeLessThan(alphaOf(strong)!);
    expect(alphaOf(faint)).toBe(16);
  });

  it('leaves the paper style opaque, so only X-ray is affected', () => {
    const paper = projectFolded3dModel(
      fixture('spikes_small'),
      options({ style: { ...STYLE, transparentAlpha: 16 / 255 } })
    );
    for (const primitive of fills(paper.snapshot.primitives)) {
      if (primitive.style.paint.kind === 'color') {
        expect(primitive.style.paint.color.alpha).toBe(255);
      }
    }
  });
});

describe('the frame a 3D figure draws inside', () => {
  // Two properties, and the feature is broken without either: the frame must not
  // change as the model turns (or the chrome jumps under the cursor), and it must
  // sit on the figure (or the overlay's invisible click polygon lands somewhere
  // else and the figure stops responding to clicks — which is what shipped).
  const CAMERAS: Array<[string, FoldedFigureCamera]> = [
    ['fold', DEFAULT_FOLDED_3D_CAMERA],
    ['turned', { ...DEFAULT_FOLDED_3D_CAMERA, yaw: 1.1, pitch: -0.2 }],
    ['antipodal', antipodalCamera(DEFAULT_FOLDED_3D_CAMERA)],
  ];

  function framedEntry(name: string, camera: FoldedFigureCamera) {
    const model = fixture(name);
    const snapshot = projectFolded3dModel(model, options({ camera })).snapshot;
    return {
      id: 'f',
      title: 'f',
      handle: 1,
      sourceKind: 'generated-3d',
      sourceCpRevision: null,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      snapshot: null,
      folded3d: {},
      renderSnapshot: snapshot,
      placement: IDENTITY_FOLDED_PLACEMENT,
      error: null,
      frameRadius: folded3dFrameRadius(model, camera),
    } as unknown as OristudioCpFoldedFigureEntry;
  }

  it('is the same box at every camera', () => {
    const boxes = CAMERAS.map(([, camera]) => foldedFigureBox(framedEntry('spikes_small', camera))!);
    for (const box of boxes) expect(box).toEqual(boxes[0]);
    // Non-vacuous: the projection genuinely differs between these cameras, so a
    // box that followed it would differ too.
    const drawn = CAMERAS.map(
      ([, camera]) =>
        foldedFigureLocalGeometry(
          projectFolded3dModel(fixture('spikes_small'), options({ camera })).snapshot
        ).bounds!
    );
    expect(drawn[1]).not.toEqual(drawn[0]);
  });

  it('contains the drawing at every camera, so nothing escapes its chrome', () => {
    for (const [name, camera] of CAMERAS) {
      const entry = framedEntry('spikes_small', camera);
      const box = foldedFigureBox(entry)!;
      const drawn = foldedFigureLocalGeometry(entry.renderSnapshot!).bounds!;
      expect(drawn.minX, name).toBeGreaterThanOrEqual(box.center.x - box.width / 2 - 0.01);
      expect(drawn.maxX, name).toBeLessThanOrEqual(box.center.x + box.width / 2 + 0.01);
      expect(drawn.minY, name).toBeGreaterThanOrEqual(box.center.y - box.height / 2 - 0.01);
      expect(drawn.maxY, name).toBeLessThanOrEqual(box.center.y + box.height / 2 + 0.01);
    }
  });
});

describe('an undecided cell', () => {
  // No admitted corpus model has one — 17 of 18 order with zero undetermined
  // pairs — so the flag is set on a real payload rather than a model invented
  // for it. It is a payload-level property, and the projector reads it as one.
  function withUndetermined(name: string, cell: number): OristudioCpFolded3dRenderModel {
    const model = fixture(name);
    const attr = [...model.cell_attr];
    attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 5] = FOLDED_3D_CELL_UNDETERMINED;
    return { ...model, cell_attr: attr, undetermined_cells: 1 };
  }

  it('is annotated, not tie-broken', () => {
    const model = withUndetermined('box_90', 0);
    const projection = projectFolded3dModel(model, options({ mergeCoplanar: false }));
    const red = undeterminedCellColor();
    const annotations = projection.snapshot.primitives.filter(
      (primitive) => primitive.kind === 'fill_polygon'
    );
    expect(annotations.length).toBeGreaterThan(0);
    for (const annotation of annotations) {
      expect(annotation.style.paint).toEqual({ kind: 'color', color: red });
    }
    // The layers below it still draw, at the annotation's alpha.
    const faded = fills(projection.snapshot.primitives).filter(
      (primitive) =>
        primitive.style.paint.kind === 'color' &&
        primitive.style.paint.color.alpha === Math.round(UNDETERMINED_FACE_ALPHA * 255)
    );
    expect(faded.length).toBe(cellStack(model, 0).length);
  });

  it('leaves a determined figure with no annotation at all', () => {
    const projection = projectFolded3dModel(fixture('box_90'), options());
    expect(
      projection.snapshot.primitives.some((primitive) => primitive.kind === 'fill_polygon')
    ).toBe(false);
    expect(projection.stats.undeterminedCells).toBe(0);
  });
});

describe('the camera', () => {
  it('is a pure function of the payload and the side', () => {
    const model = fixture('spikes_small');
    expect(defaultFolded3dCamera(model)).toEqual(defaultFolded3dCamera(model));
    expect(defaultFolded3dCamera(model)).toEqual(DEFAULT_FOLDED_3D_CAMERA);
    const back = defaultFolded3dCamera(model, 'Back1');
    // `π − pitch`, not `−pitch`. Negating the pitch alone leaves the eye exactly
    // where it was once the yaw has turned too, so the "back" view would be the
    // front view and nothing would look wrong enough to notice.
    expect(back.pitch).toBeCloseTo(Math.PI - DEFAULT_FOLDED_3D_CAMERA.pitch, 12);
    expect(back.yaw).toBeCloseTo(DEFAULT_FOLDED_3D_CAMERA.yaw + Math.PI, 12);
    expect(back).toEqual(antipodalCamera(DEFAULT_FOLDED_3D_CAMERA));
    // `Both2` is the flat figure's side-by-side pair and has no 3D reading.
    expect(defaultFolded3dCamera(model, 'Both2')).toEqual(defaultFolded3dCamera(model, 'Front0'));
  });

  it('turns to the other side and back again', () => {
    // The verb a 3D figure offers where a flat one offers Flip. It has to be an
    // involution — press twice, same view — or the button walks the figure round
    // in circles instead of toggling it.
    const there = foldedFigureOtherSideCamera(DEFAULT_FOLDED_3D_CAMERA);
    expect(there).toEqual(antipodalCamera(DEFAULT_FOLDED_3D_CAMERA));
    const back = foldedFigureOtherSideCamera(there);
    expect(Math.cos(back.yaw)).toBeCloseTo(Math.cos(DEFAULT_FOLDED_3D_CAMERA.yaw), 12);
    expect(Math.sin(back.yaw)).toBeCloseTo(Math.sin(DEFAULT_FOLDED_3D_CAMERA.yaw), 12);
    expect(folded3dEyeDirection(back)).toEqual(
      folded3dEyeDirection(DEFAULT_FOLDED_3D_CAMERA).map((component) =>
        expect.closeTo(component, 12)
      ) as unknown as ReturnType<typeof folded3dEyeDirection>
    );
    // A figure with no recorded camera is shown at the default, so turning it
    // over is the antipode of that rather than a refusal.
    expect(foldedFigureOtherSideCamera(null)).toEqual(there);
  });

  it('reverses the drawing order when the eye moves to the other side', () => {
    // The build never consults the eye at `edgeInk: 0`, so one tree serves both
    // viewpoints; only the traversal is camera-dependent.
    const model = fixture('box_90');
    const camera: FoldedFigureCamera = { yaw: 0.4, pitch: 0.5, zoom: 1 };
    const front = planeOrder(model, camera);
    const back = planeOrder(model, antipodalCamera(camera));
    expect([...front].reverse()).toEqual(back);
  });

  it('scales with zoom and translates with the anchor', () => {
    const model = fixture('hinge_90');
    const one = projectFolded3dModel(model, options({ mergeCoplanar: false }));
    const two = projectFolded3dModel(
      model,
      options({
        camera: { ...DEFAULT_FOLDED_3D_CAMERA, zoom: 2 },
        anchor: { x: 100, y: -50 },
        mergeCoplanar: false,
      })
    );
    expect(paintedArea(two.snapshot.primitives)).toBeCloseTo(
      paintedArea(one.snapshot.primitives) * 4,
      6
    );
  });
});

describe('display styles', () => {
  const model = () => fixture('box_90');

  it('draws paper and creases for Paper5', () => {
    const projection = projectFolded3dModel(model(), options());
    expect(fills(projection.snapshot.primitives).length).toBeGreaterThan(0);
    expect(strokes(projection.snapshot.primitives).length).toBeGreaterThan(0);
  });

  it('draws creases alone for Wire2, and for the two Development styles', () => {
    for (const style of ['Wire2', 'Development1', 'Development4'] as const) {
      const projection = projectFolded3dModel(model(), options({ displayStyle: style }));
      expect(fills(projection.snapshot.primitives)).toHaveLength(0);
      expect(strokes(projection.snapshot.primitives).length).toBeGreaterThan(0);
    }
  });

  it('draws nothing for None0', () => {
    const projection = projectFolded3dModel(model(), options({ displayStyle: 'None0' }));
    expect(projection.snapshot.primitives).toHaveLength(0);
  });

  it('makes every cell translucent for Transparent3, with no red', () => {
    const projection = projectFolded3dModel(model(), options({ displayStyle: 'Transparent3' }));
    for (const primitive of fills(projection.snapshot.primitives)) {
      expect(primitive.style.paint.kind).toBe('color');
      if (primitive.style.paint.kind === 'color') {
        expect(primitive.style.paint.color.alpha).toBeLessThan(255);
      }
    }
    expect(
      projection.snapshot.primitives.some((primitive) => primitive.kind === 'fill_polygon')
    ).toBe(false);
  });
});

describe('the guards', () => {
  it('degrades to a depth sort rather than refusing the figure', () => {
    const model = fixture('box_90');
    const projection = projectFolded3dModel(model, options({ itemBudget: 1 }));
    expect(projection.order).toBe('depth-sorted');
    expect(projection.snapshot.primitives.length).toBeGreaterThan(0);
    expect(projectFolded3dModel(model, options()).order).toBe('bsp');
  });

  it('sits far above anything the corpus reaches', () => {
    // Cell triangles plus edges. The worst admitted external corpus model is
    // 6,638; the committed fixtures are three orders below that.
    for (const name of ['hinge_90', 'box_90', 'spikes_small', 'pinwheel_cyclic']) {
      const projection = projectFolded3dModel(fixture(name), options());
      expect(projection.stats.items).toBeLessThan(BSP_ITEM_BUDGET);
      expect(projection.order).toBe('bsp');
    }
  });

  it('derives its coplanarity tolerance as a distance, not an angle', () => {
    const model = fixture('box_90');
    const epsilon = folded3dCoplanarEpsilon(model, TOLERANCES);
    // Well above `bsp.ts`'s own 1e-7, and still a millionth of the span.
    expect(epsilon).toBeGreaterThan(1e-6);
    expect(epsilon).toBeLessThan(model.span * 1e-5);
    // It scales with the offset tolerance, which an angle would not.
    expect(
      folded3dCoplanarEpsilon(model, { ...TOLERANCES, distance_relative: 1e-5 })
    ).toBeGreaterThan(epsilon * 5);
  });

  it('hands that tolerance to the tree rather than letting it default', () => {
    // The wiring, not just the value. Replacing the call with `bsp.ts`'s own
    // 1e-7 changes no other assertion in this file — every fixture's planes are
    // far enough apart that nothing reclassifies — so without this the exact
    // regression the epsilon exists to prevent would ship green.
    const model = fixture('box_90');
    expect(projectFolded3dModel(model, options()).stats.coplanarEps).toBe(
      folded3dCoplanarEpsilon(model, TOLERANCES)
    );
    const loose: OristudioCpFold3dTolerances = { ...TOLERANCES, distance_relative: 1e-4 };
    expect(projectFolded3dModel(model, options({ tolerances: loose })).stats.coplanarEps).toBe(
      folded3dCoplanarEpsilon(model, loose)
    );
  });
});

describe('culling and merging', () => {
  it('merging is exactly area-preserving', () => {
    // A run is replaced by its outline, which tiles the same region, so the
    // paper covered is identical and only the shape count falls.
    const model = fixture('box_90');
    const bare = projectFolded3dModel(
      model,
      options({ cullHidden: false, mergeCoplanar: false })
    );
    const merged = projectFolded3dModel(model, options({ cullHidden: false }));
    for (const [cell, area] of areaByCell(bare)) {
      expect(areaByCell(merged).get(cell)).toBeCloseTo(area, 6);
    }
    expect(merged.snapshot.primitives.length).toBeLessThanOrEqual(
      bare.snapshot.primitives.length
    );
  });

  it('culling drops only paper nothing shows', () => {
    const model = fixture('box_90');
    const bare = projectFolded3dModel(
      model,
      options({ cullHidden: false, mergeCoplanar: false })
    );
    const culled = projectFolded3dModel(model, options({ mergeCoplanar: false }));
    expect(culled.snapshot.primitives.length).toBeLessThan(bare.snapshot.primitives.length);
    // Never more paper than before, and every surviving cell is one that was
    // already there.
    expect(paintedArea(culled.snapshot.primitives)).toBeLessThanOrEqual(
      paintedArea(bare.snapshot.primitives) + 1e-6
    );
    const before = new Set(bare.cells);
    for (const cell of culled.cells) expect(before).toContain(cell);
  });

  it('is skipped when anything is translucent', () => {
    // Culling reads what is on top; translucent paper shows what is under it, so
    // the pass would delete geometry that contributes colour. Under a translucent
    // style every layer of every cell survives, so a cell's painted area is its
    // ring area times its stack depth.
    const model = fixture('box_90');
    const opaque = areaByCell(
      projectFolded3dModel(model, options({ cullHidden: false, mergeCoplanar: false }))
    );
    const clear = areaByCell(
      projectFolded3dModel(
        model,
        options({ displayStyle: 'Transparent3', mergeCoplanar: false })
      )
    );
    expect(clear.size).toBe(model.cell_count);
    for (const [cell, area] of clear) {
      expect(area).toBeCloseTo((opaque.get(cell) ?? 0) * cellStack(model, cell).length, 6);
    }
  });
});

/* --------------------------------------------------------------------------
 * helpers
 * ----------------------------------------------------------------------- */

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The planes, in the order their paper is first drawn.
 *
 * Enough to say "plane A before plane B" without depending on how many pieces
 * the tree cut, which is what makes it stable across tolerance changes.
 */
function planeOrder(
  model: OristudioCpFolded3dRenderModel,
  camera: FoldedFigureCamera
): number[] {
  const projection = projectFolded3dModel(
    model,
    options({ camera, displayStyle: 'Paper5', cullHidden: false, mergeCoplanar: false })
  );
  const seen: number[] = [];
  projection.snapshot.primitives.forEach((primitive, index) => {
    if (primitive.kind !== 'fill_path') return;
    const plane = cellAttr(model, projection.cells[index]!, 0);
    if (!seen.includes(plane)) seen.push(plane);
  });
  return seen;
}

function hasCycle(relations: ReadonlyArray<readonly [number, number]>, nodes: number): boolean {
  const indegree = new Array<number>(nodes).fill(0);
  const adjacency: number[][] = Array.from({ length: nodes }, () => []);
  for (const [upper, lower] of relations) {
    adjacency[upper]!.push(lower);
    indegree[lower]! += 1;
  }
  const queue = [...Array(nodes).keys()].filter((node) => indegree[node] === 0);
  let seen = 0;
  while (queue.length > 0) {
    const node = queue.pop()!;
    seen += 1;
    for (const next of adjacency[node]!) {
      indegree[next]! -= 1;
      if (indegree[next] === 0) queue.push(next);
    }
  }
  return seen !== nodes;
}

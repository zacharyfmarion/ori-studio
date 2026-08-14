/**
 * The ink rule, against real kernel payloads.
 *
 * `buildFolded3dInk` is the answer to "does this layer's paper end here", and
 * both renderers draw their creases from it. So the tests that matter are the
 * ones a wrong answer would break: nothing is lost, nothing is invented, and a
 * buried layer does not claim a segment its own paper runs across.
 *
 * Every fixture is the kernel's own `Folded3dRenderModel` — see
 * `__fixtures__/README.md`. Nothing here is hand-written.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_EDGE_ATTR_STRIDE,
  type OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import {
  FOLDED_3D_INK_TOLERANCE_RELATIVE,
  buildFolded3dInk,
  cellRing,
  cellStack,
} from './folded3dModelReader';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const NAMES = [
  'hinge_90',
  'strip_coupled',
  'pinwheel',
  'pinwheel_cyclic',
  'box_90',
  'spikes_small',
] as const;

function load(name: string): OristudioCpFolded3dRenderModel {
  return JSON.parse(
    readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8')
  ) as OristudioCpFolded3dRenderModel;
}

function ringLength(model: OristudioCpFolded3dRenderModel, cell: number): number {
  return model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 2] ?? 0;
}

/** Every `(cell, slot, segment) -> edge` the model inks, as a comparable list. */
function inkTable(
  model: OristudioCpFolded3dRenderModel,
  tolerance = FOLDED_3D_INK_TOLERANCE_RELATIVE
): string[] {
  const ink = buildFolded3dInk({ ...model, span: (model.span * tolerance) / FOLDED_3D_INK_TOLERANCE_RELATIVE });
  const rows: string[] = [];
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const segments = ringLength(model, cell);
    const stack = cellStack(model, cell);
    for (let slot = 0; slot < stack.length; slot += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const edge = ink.edgeAt(cell, slot, segment);
        if (edge >= 0) rows.push(`${cell}/${slot}/${segment}=${edge}`);
      }
    }
  }
  return rows;
}

describe('buildFolded3dInk', () => {
  it.each(NAMES)('loses no crease: %s', (name) => {
    const model = load(name);
    // A crease inked nowhere would silently vanish from the drawing, which is
    // why the builder reports them rather than asserting. On the committed
    // fixtures there are none, and that is the statement worth holding.
    expect(buildFolded3dInk(model).orphanEdges).toEqual([]);
  });

  it.each(NAMES)('invents no crease: %s', (name) => {
    const model = load(name);
    const ink = buildFolded3dInk(model);
    for (let cell = 0; cell < model.cell_count; cell += 1) {
      const segments = ringLength(model, cell);
      const ring = cellRing(model, cell);
      const stack = cellStack(model, cell);
      for (let slot = 0; slot < stack.length; slot += 1) {
        const face = stack[slot]!;
        for (let segment = 0; segment < segments; segment += 1) {
          const edge = ink.edgeAt(cell, slot, segment);
          if (edge < 0) continue;
          const base = edge * FOLDED_3D_EDGE_ATTR_STRIDE;
          const faceA = model.edge_attr[base] ?? -1;
          const faceB = model.edge_attr[base + 1] ?? -1;
          // An inked segment is an edge *of the paper at this slot*. Anything
          // else is a crease drawn at a layer it does not belong to, which is
          // the whole bug this exists to remove.
          expect([faceA, faceB]).toContain(face);
          // And it is the segment it claims to be, not a neighbour: both ends
          // of the ring segment lie on that edge.
          const [ax, ay, az] = [
            model.edge_points[edge * 6]!,
            model.edge_points[edge * 6 + 1]!,
            model.edge_points[edge * 6 + 2]!,
          ];
          const [bx, by, bz] = [
            model.edge_points[edge * 6 + 3]!,
            model.edge_points[edge * 6 + 4]!,
            model.edge_points[edge * 6 + 5]!,
          ];
          const length = Math.hypot(bx - ax, by - ay, bz - az);
          for (const point of [ring[segment]!, ring[(segment + 1) % segments]!]) {
            const near =
              Math.hypot(point[0] - ax, point[1] - ay, point[2] - az) +
              Math.hypot(point[0] - bx, point[1] - by, point[2] - bz);
            expect(near).toBeLessThanOrEqual(length + FOLDED_3D_INK_TOLERANCE_RELATIVE * model.span);
          }
        }
      }
    }
  });

  it.each(NAMES)('inkIsNotSensitiveToTheTolerance: %s', (name) => {
    const model = load(name);
    const shipped = inkTable(model);
    // The plateau the shipped bar sits in the middle of — see
    // FOLDED_3D_INK_TOLERANCE_RELATIVE. Three orders either way is the same ink;
    // a change that narrows the gap between real drift and the nearest
    // non-match shows up here before it shows up as a missing crease.
    expect(inkTable(model, FOLDED_3D_INK_TOLERANCE_RELATIVE * 1e-3)).toEqual(shipped);
    expect(inkTable(model, FOLDED_3D_INK_TOLERANCE_RELATIVE * 1e3)).toEqual(shipped);
  });

  it('a buried layer does not claim the paper that covers it', () => {
    // `pinwheel` is one plane, four arms folded flat back over a square centre,
    // stacks up to three deep — so every cell of it is exactly the case the
    // arrangement cuts one face and not another.
    const model = load('pinwheel');
    const ink = buildFolded3dInk(model);
    let crossed = 0;
    let ended = 0;
    for (let cell = 0; cell < model.cell_count; cell += 1) {
      const segments = ringLength(model, cell);
      const stack = cellStack(model, cell);
      if (stack.length < 2) continue;
      for (let slot = 0; slot < stack.length; slot += 1) {
        for (let segment = 0; segment < segments; segment += 1) {
          if (ink.edgeAt(cell, slot, segment) >= 0) ended += 1;
          else crossed += 1;
        }
      }
    }
    // Both arms of the rule are exercised: some segments end a layer's paper and
    // some are cuts it runs across. A builder that inked everything (today's
    // behaviour) or nothing would satisfy neither.
    expect(ended).toBeGreaterThan(0);
    expect(crossed).toBeGreaterThan(0);
  });

  it('a face that overlaps nothing inks its whole ring', () => {
    // `hinge_90` is two triangles at 90°, one cell each and nothing overlapping,
    // so every cell ring segment is a real paper edge. The degenerate case the
    // rule has to get right before any stacking is involved.
    const model = load('hinge_90');
    const ink = buildFolded3dInk(model);
    for (let cell = 0; cell < model.cell_count; cell += 1) {
      const segments = ringLength(model, cell);
      for (let segment = 0; segment < segments; segment += 1) {
        expect(ink.edgeAt(cell, 0, segment)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reads nothing outside a cell, a stack or a ring', () => {
    const model = load('box_90');
    const ink = buildFolded3dInk(model);
    expect(ink.edgeAt(-1, 0, 0)).toBe(-1);
    expect(ink.edgeAt(model.cell_count, 0, 0)).toBe(-1);
    expect(ink.edgeAt(0, -1, 0)).toBe(-1);
    expect(ink.edgeAt(0, 999, 0)).toBe(-1);
    expect(ink.edgeAt(0, 0, -1)).toBe(-1);
    expect(ink.edgeAt(0, 0, 999)).toBe(-1);
  });
});

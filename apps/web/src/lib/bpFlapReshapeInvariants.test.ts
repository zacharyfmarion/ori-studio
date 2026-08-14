import { describe, expect, it } from 'vitest';
import {
  BP_FLAP_HANDLE_SIGNS,
  BP_FLAP_RESIZE_HANDLES,
  bpFlapOuterBox,
  solveBpFlapReshape,
  type BpFlapFootprint,
  type BpFlapResizeHandle,
} from './bpFlapReshape';
import type { OristudioBpFlap, OristudioBpSheet } from '../engine/oristudioBpTypes';

/**
 * Properties the resize solve must have for *every* input, swept rather than
 * sampled.
 *
 * Separate from `bpFlapReshape.test.ts`, which pins the specific rule — what the
 * radius does with a given drag is a product decision and has changed three
 * times. Nothing here encodes that choice. These are the invariants any rule has
 * to satisfy, and most of them are things whose violation would be a real defect
 * rather than a preference: a fractional coordinate destroys the whole design's
 * gadget generation, a moving pinned edge makes the gesture unusable, and a
 * non-monotone drag makes it feel broken.
 *
 * The sweep is deliberately wide — every handle, a range of flap shapes, and
 * deltas well past what a sane drag produces — because the interesting failures
 * were all at boundaries: a zero dimension, a radius at its floor, a box that
 * cannot shrink further.
 */

/**
 * Both sheet kinds, because they answer "is this on the paper" differently: a
 * diagonal sheet is a square placed as a diamond, with a half-cell frame shift on
 * odd sizes, and its containment goes through `diagonalConstrain` rather than a
 * rectangle test. An odd diagonal size is included on purpose — that shift is
 * where a fractional coordinate would come from if one could.
 */
const SHEETS: ReadonlyArray<readonly [string, OristudioBpSheet, { x: number; y: number }]> = [
  [
    'rect 64',
    { kind: 'rectangular', width: 64, height: 64, grid: { kind: 'rectangular', interval: 1, snap: true } },
    { x: 30, y: 30 },
  ],
  [
    'diagonal 64',
    { kind: 'diagonal', width: 64, height: 64, grid: { kind: 'diagonal', interval: 1, snap: true } },
    { x: 32, y: 32 },
  ],
  [
    'diagonal 33',
    { kind: 'diagonal', width: 33, height: 33, grid: { kind: 'diagonal', interval: 1, snap: true } },
    { x: 16, y: 16 },
  ],
];

const RADIUS = { min: 1, max: 1000 };

/** Flap shapes worth sweeping: the degenerate ones, and a few with a real box. */
const SHAPES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 1], // the default flap, and the tightest case there is
  [0, 0, 2],
  [0, 0, 5],
  [1, 0, 1],
  [0, 1, 1],
  [4, 0, 3], // horizontal capsule
  [0, 4, 3], // vertical capsule
  [2, 2, 2], // square box
  [5, 1, 3], // oblong box
  [1, 5, 3],
  [7, 3, 1], // box much larger than the radius
];

const DELTAS = [-9, -5, -3, -2, -1, 0, 1, 2, 3, 5, 9];

function flap(width: number, height: number, radius: number, at = { x: 30, y: 30 }): OristudioBpFlap {
  return { id: 1, vertexId: 1, name: '', anchor: at, width, height, radius, constrained: true };
}

function solve(
  source: OristudioBpFlap,
  handle: BpFlapResizeHandle,
  dx: number,
  dy: number,
  sheet: OristudioBpSheet = SHEETS[0][1]
): BpFlapFootprint | null {
  const outer = bpFlapOuterBox(source);
  const s = BP_FLAP_HANDLE_SIGNS[handle];
  return solveBpFlapReshape({
    flap: source,
    handle,
    pointer: {
      x: s.sx === 1 ? outer.x + outer.width + dx : s.sx === -1 ? outer.x - dx : outer.x,
      y: s.sy === 1 ? outer.y + outer.height + dy : s.sy === -1 ? outer.y - dy : outer.y,
    },
    radiusRange: RADIUS,
    sheet,
  });
}

/** Every (shape, handle, delta) the sweep covers, with its solved footprint. */
function* sweep(): Generator<{
  sheetName: string;
  source: OristudioBpFlap;
  handle: BpFlapResizeHandle;
  dx: number;
  dy: number;
  result: BpFlapFootprint;
}> {
  for (const [sheetName, sheet, at] of SHEETS) {
    for (const [w, h, r] of SHAPES) {
      const source = flap(w, h, r, at);
      for (const handle of BP_FLAP_RESIZE_HANDLES) {
        const s = BP_FLAP_HANDLE_SIGNS[handle];
        for (const dx of s.sx === 0 ? [0] : DELTAS) {
          for (const dy of s.sy === 0 ? [0] : DELTAS) {
            const result = solve(source, handle, dx, dy, sheet);
            if (result) yield { sheetName, source, handle, dx, dy, result };
          }
        }
      }
    }
  }
}

function describeCase(c: {
  sheetName?: string;
  source: OristudioBpFlap;
  handle: string;
  dx: number;
  dy: number;
}): string {
  const { width: w, height: h, radius: r } = c.source;
  return `[${c.sheetName ?? 'rect 64'}] ${w}x${h} r${r} ${c.handle} (${c.dx},${c.dy})`;
}

describe('resize solve invariants', () => {
  it('sweeps a meaningful number of cases', () => {
    // Guards every test below from passing because the sweep produced nothing.
    expect([...sweep()].length).toBeGreaterThan(1500);
  });

  it('never produces a fractional field', () => {
    // The sharpest one. A fractional flap coordinate makes the junction overlap
    // fractional, and BP's gadget generation then hard-errors for the WHOLE
    // design — every crease and conflict vanishes, with no toast and no log.
    for (const c of sweep()) {
      const fields = [
        c.result.anchor.x,
        c.result.anchor.y,
        c.result.width,
        c.result.height,
        c.result.radius,
      ];
      for (const value of fields) {
        expect(Number.isInteger(value), `${describeCase(c)} -> ${value}`).toBe(true);
      }
    }
  });

  it('never produces a negative box or an out-of-range radius', () => {
    for (const c of sweep()) {
      expect(c.result.width, describeCase(c)).toBeGreaterThanOrEqual(0);
      expect(c.result.height, describeCase(c)).toBeGreaterThanOrEqual(0);
      expect(c.result.radius, describeCase(c)).toBeGreaterThanOrEqual(RADIUS.min);
      expect(c.result.radius, describeCase(c)).toBeLessThanOrEqual(RADIUS.max);
    }
  });

  it('never moves an edge the handle is not dragging', () => {
    // The one that makes a resize feel like a resize rather than a shove.
    for (const c of sweep()) {
      const before = bpFlapOuterBox(c.source);
      const after = bpFlapOuterBox(c.result);
      const s = BP_FLAP_HANDLE_SIGNS[c.handle];
      if (s.sx !== 1) {
        expect(after.x + after.width, `${describeCase(c)} east edge`).toBe(before.x + before.width);
      }
      if (s.sx !== -1) expect(after.x, `${describeCase(c)} west edge`).toBe(before.x);
      if (s.sy !== 1) {
        expect(after.y + after.height, `${describeCase(c)} north edge`).toBe(
          before.y + before.height
        );
      }
      if (s.sy !== -1) expect(after.y, `${describeCase(c)} south edge`).toBe(before.y);
    }
  });

  it('never moves the dragged edge past the pointer, or the wrong way', () => {
    // A request the flap cannot be is clamped back toward the start rather than
    // refused, so the handle stops at the limit instead of freezing. What must
    // never happen is landing *beyond* what was asked, or moving against the
    // drag.
    for (const c of sweep()) {
      const before = bpFlapOuterBox(c.source);
      const after = bpFlapOuterBox(c.result);
      const s = BP_FLAP_HANDLE_SIGNS[c.handle];
      const check = (axis: string, was: number, now: number, asked: number) => {
        const got = now - was;
        expect(Math.abs(got), `${describeCase(c)} ${axis} overshoot`).toBeLessThanOrEqual(
          Math.abs(asked)
        );
        if (asked !== 0 && got !== 0) {
          expect(Math.sign(got), `${describeCase(c)} ${axis} direction`).toBe(Math.sign(asked));
        }
      };
      if (s.sx !== 0) check('width', before.width, after.width, c.dx);
      if (s.sy !== 0) check('height', before.height, after.height, c.dy);
    }
  });

  it('lands exactly on the pointer whenever the flap can be that box', () => {
    // Two things legitimately clamp a request: a box below the 2x2 floor a radius
    // of 1 needs, and the sheet's own at-most-one-tip-off rule. This asserts
    // exactness where neither can bite — a rectangular sheet with the flap
    // parked well inside it — and leaves the clamped cases to the contract
    // asserted above, which is the honest thing to say about them.
    const [, sheet, at] = SHEETS[0];
    for (const [w, h, r] of SHAPES) {
      const source = flap(w, h, r, at);
      const before = bpFlapOuterBox(source);
      for (const handle of BP_FLAP_RESIZE_HANDLES) {
        const s = BP_FLAP_HANDLE_SIGNS[handle];
        for (const dx of s.sx === 0 ? [0] : DELTAS) {
          for (const dy of s.sy === 0 ? [0] : DELTAS) {
            const wanted = { width: before.width + dx, height: before.height + dy };
            // Below the 2x2 floor a radius of 1 needs...
            if (wanted.width < 2 || wanted.height < 2) continue;
            // ...or, for an edge drag, pushed in past the flap's own circle,
            // which is where an edge stops because it never moves the radius.
            const edge = s.sx === 0 || s.sy === 0;
            if (edge && (wanted.width < 2 * r || wanted.height < 2 * r)) continue;
            const result = solve(source, handle, dx, dy, sheet);
            if (!result) continue;
            const after = bpFlapOuterBox(result);
            const where = `${w}x${h} r${r} ${handle} (${dx},${dy})`;
            if (s.sx !== 0) expect(after.width, `${where} width`).toBe(wanted.width);
            if (s.sy !== 0) expect(after.height, `${where} height`).toBe(wanted.height);
          }
        }
      }
    }
  });

  it('stops an edge drag at the flap\'s own circle rather than shrinking it', () => {
    // An edge drag never moves the radius, so the outer extent cannot go below
    // the diameter. The handle stops there instead of collapsing the flap's
    // length, which is the whole point of splitting edge from corner.
    for (const [w, h, r] of SHAPES) {
      const source = flap(w, h, r);
      for (const handle of ['e', 'w', 'n', 's'] as const) {
        const s = BP_FLAP_HANDLE_SIGNS[handle];
        const result = solve(source, handle, s.sx === 0 ? 0 : -20, s.sy === 0 ? 0 : -20);
        if (!result) continue;
        expect(result.radius, `${w}x${h} r${r} ${handle}`).toBe(r);
        const box = bpFlapOuterBox(result);
        const driven = s.sx !== 0 ? box.width : box.height;
        expect(driven, `${w}x${h} r${r} ${handle} floor`).toBeGreaterThanOrEqual(2 * r);
      }
    }
  });

  it('never moves the radius on an edge drag', () => {
    for (const c of sweep()) {
      const s = BP_FLAP_HANDLE_SIGNS[c.handle];
      if (s.sx !== 0 && s.sy !== 0) continue;
      expect(c.result.radius, describeCase(c)).toBe(c.source.radius);
    }
  });

  it('moves the box by at most one cell per cell of drag', () => {
    // The user-visible form of the complaint. The radius is already continuous,
    // but h = H - 2r, so a radius that steps by one steps the box by *two* - and
    // a one-cell nudge on one axis then restructures the other. This is the
    // invariant the "maximise the radius" rule broke.
    for (const [w, h, r] of SHAPES) {
      const source = flap(w, h, r);
      for (const handle of BP_FLAP_RESIZE_HANDLES) {
        const s = BP_FLAP_HANDLE_SIGNS[handle];
        for (let d = -8; d < 8; d++) {
          const a = solve(source, handle, s.sx === 0 ? 0 : d, s.sy === 0 ? 0 : d);
          const b = solve(source, handle, s.sx === 0 ? 0 : d + 1, s.sy === 0 ? 0 : d + 1);
          if (!a || !b) continue;
          const where = `${w}x${h} r${r} ${handle} between ${d} and ${d + 1}`;
          expect(Math.abs(b.width - a.width), `${where} width`).toBeLessThanOrEqual(1);
          expect(Math.abs(b.height - a.height), `${where} height`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is monotone: dragging further out never gives a smaller box', () => {
    for (const [w, h, r] of SHAPES) {
      const source = flap(w, h, r);
      for (const handle of BP_FLAP_RESIZE_HANDLES) {
        const s = BP_FLAP_HANDLE_SIGNS[handle];
        let previous: number | null = null;
        for (const d of DELTAS) {
          const result = solve(source, handle, s.sx === 0 ? 0 : d, s.sy === 0 ? 0 : d);
          if (!result) continue;
          const box = bpFlapOuterBox(result);
          const extent = s.sx !== 0 ? box.width : box.height;
          if (previous !== null) {
            expect(extent, `${w}x${h} r${r} ${handle} at ${d}`).toBeGreaterThanOrEqual(previous);
          }
          previous = extent;
        }
      }
    }
  });

  it('never shrinks the radius on a drag that only grows the box', () => {
    // Growing a flap must not make it shorter in the folded model.
    for (const c of sweep()) {
      if (c.dx < 0 || c.dy < 0) continue;
      expect(c.result.radius, describeCase(c)).toBeGreaterThanOrEqual(c.source.radius);
    }
  });

  it('moves the radius by at most one cell per cell of drag', () => {
    // Continuity. A rule that can swing the radius by more than the drag makes a
    // one-cell nudge restructure the flap, which is what "weird" means here.
    for (const [w, h, r] of SHAPES) {
      const source = flap(w, h, r);
      for (const handle of BP_FLAP_RESIZE_HANDLES) {
        const s = BP_FLAP_HANDLE_SIGNS[handle];
        for (let d = -8; d < 8; d++) {
          const a = solve(source, handle, s.sx === 0 ? 0 : d, s.sy === 0 ? 0 : d);
          const b = solve(source, handle, s.sx === 0 ? 0 : d + 1, s.sy === 0 ? 0 : d + 1);
          if (!a || !b) continue;
          expect(
            Math.abs(b.radius - a.radius),
            `${w}x${h} r${r} ${handle} between ${d} and ${d + 1}`
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('asks for nothing when the pointer is where it began', () => {
    for (const [w, h, r] of SHAPES) {
      for (const handle of BP_FLAP_RESIZE_HANDLES) {
        expect(solve(flap(w, h, r), handle, 0, 0), `${w}x${h} r${r} ${handle}`).toBeNull();
      }
    }
  });

  it('returns to the start when the drag is undone', () => {
    // Within a gesture every step solves from the same start, so this is what
    // makes an overshoot recoverable.
    for (const c of sweep()) {
      const back = solve(c.source, c.handle, 0, 0);
      expect(back, describeCase(c)).toBeNull();
    }
  });
});

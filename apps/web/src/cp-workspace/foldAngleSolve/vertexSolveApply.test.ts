/**
 * The three-angle vertex solve driven end to end through the real kernel, over
 * the reported failure case.
 *
 * # Why this exists beside the Rust test that covers the same thing
 *
 * `oristudio-cp` already pins this at the kernel level, and that test would have
 * caught the bug. What it cannot catch is the bug arriving in the browser
 * anyway: the `.js`/`.d.ts` glue is unchanged by a body-only kernel edit, so
 * lint, typecheck and vitest all pass over a stale `.wasm` and say nothing. The
 * `pre*` npm hooks rebuild the bridge, and this test is what makes that rebuild
 * mean something — it exercises `execute_cp_command`, so a kernel fix that never
 * reached the artifact reds here rather than shipping green.
 *
 * # The case
 *
 * `failure_case.osf`'s vertex at (550, 1450): degree 6, five decided creases and
 * one unassigned crease hinted Valley. Selecting the unassigned crease and the
 * two opposite 109.4712206 valleys gives three isolated answers. Applying the
 * first used to write the two decided creases and silently skip the third,
 * leaving it undecided — and rendering as the undecided dash — at a vertex the
 * tool had just reported closed.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  document_snapshot,
  execute_cp_command,
  free_document,
  load_cp,
  load_document,
  preview_cp_command,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import type {
  OristudioCpCommandPreview,
  OristudioCpDocumentSnapshot,
  OristudioCpFoldDirectionHint,
  OristudioCpLineColor,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';

beforeAll(initCpWasm);

/** `1094712206` is 109.4712206 degrees; the kernel stores |degrees| x 1e7. */
const UNITS_PER_DEGREE = 1e7;

const VERTEX = { x: 550, y: 1450 };

/**
 * The vertex's six creases, in the document's own order.
 *
 * `magnitude` absent on a decided crease means a full 180 fold, which is the
 * canonical storage form rather than "unset" — nothing here relies on that, but
 * the two 109.47 valleys become exactly that once solved.
 */
const FAN: {
  bearing: number;
  color: OristudioCpLineColor;
  degrees?: number;
  hint?: OristudioCpFoldDirectionHint;
}[] = [
  { bearing: 180, color: 'Blue2', degrees: 109.4712206 },
  { bearing: -90, color: 'None', hint: 'Valley' },
  { bearing: 0, color: 'Blue2', degrees: 109.4712206 },
  { bearing: 45, color: 'Red1', degrees: 90 },
  { bearing: 90, color: 'Blue2', degrees: 70.5287794 },
  { bearing: 135, color: 'Red1', degrees: 90 },
];

function segment(overrides: Partial<OristudioCpLineSegment>): OristudioCpLineSegment {
  return {
    a: { x: 0, y: 0 },
    b: { x: 0, y: 0 },
    color: 'Black0',
    active: 'Inactive0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...overrides,
  };
}

/** The reported vertex inside a square sheet, and a handle to the document. */
function reportedFailureCase(): number {
  const corners = [
    [450, 1350],
    [650, 1350],
    [650, 1550],
    [450, 1550],
  ];
  const segments: OristudioCpLineSegment[] = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    return segment({
      a: { x: corner[0], y: corner[1] },
      b: { x: next[0], y: next[1] },
      color: 'Black0',
    });
  });
  for (const crease of FAN) {
    const radians = (crease.bearing * Math.PI) / 180;
    segments.push(
      segment({
        a: { ...VERTEX },
        b: {
          x: VERTEX.x + 50 * Math.cos(radians),
          y: VERTEX.y + 50 * Math.sin(radians),
        },
        color: crease.color,
        ...(crease.degrees != null
          ? { fold_magnitude: Math.round(crease.degrees * UNITS_PER_DEGREE) }
          : {}),
        ...(crease.hint != null ? { fold_direction_hint: crease.hint } : {}),
      })
    );
  }

  const seed = load_cp('', 'seed');
  const empty = document_snapshot(seed) as OristudioCpDocumentSnapshot;
  free_document(seed);
  return load_document({
    ...empty,
    crease_pattern: { ...empty.crease_pattern, line_segments: segments },
  });
}

/** `line_ids` are one-based, as every command's are; the fan starts after the border. */
const UNASSIGNED = 4 + 1 + 1;
const FIRST_VALLEY = 4 + 0 + 1;
const SECOND_VALLEY = 4 + 2 + 1;
const CHOSEN = [UNASSIGNED, FIRST_VALLEY, SECOND_VALLEY];

function linesOf(handle: number): OristudioCpLineSegment[] {
  return (document_snapshot(handle) as OristudioCpDocumentSnapshot).crease_pattern.line_segments;
}

function solve(handle: number, candidate_index: number): OristudioCpCommandPreview {
  return preview_cp_command(handle, 'VertexSolveFoldAngles', {
    points: [VERTEX],
    line_ids: CHOSEN,
    candidate_index,
  }) as OristudioCpCommandPreview;
}

describe('VertexSolveFoldAngles against the real kernel', () => {
  it('decides the unassigned crease it was given', () => {
    const handle = reportedFailureCase();
    expect(linesOf(handle)[UNASSIGNED - 1]).toMatchObject({
      color: 'None',
      fold_direction_hint: 'Valley',
    });

    // Three isolated answers — the "1 of 3" the tool reported.
    expect(solve(handle, 0).candidate_count).toBe(3);

    execute_cp_command(handle, 'VertexSolveFoldAngles', {
      points: [VERTEX],
      line_ids: CHOSEN,
      candidate_index: 0,
    });

    const solved = linesOf(handle)[UNASSIGNED - 1];
    // A solved crease is a decided crease: it takes the colour its sign implies
    // and loses the hint, which the kernel's invariant forbids once decided.
    expect(solved.color).toBe('Blue2');
    expect(solved.fold_direction_hint).toBeUndefined();
    // arccos(1/3), the same angle the vertex's remaining valley already carries.
    expect(solved.fold_magnitude).toBeCloseTo(70.5287793 * UNITS_PER_DEGREE, -1);

    // And the other two land as well — the whole answer, not two thirds. Both
    // solve to a full fold, where an absent magnitude *is* 180.
    for (const line of [FIRST_VALLEY, SECOND_VALLEY]) {
      const written = linesOf(handle)[line - 1];
      expect(written.color).toBe('Blue2');
      expect(written.fold_magnitude ?? null).toBeNull();
    }

    free_document(handle);
  });

  it('preview and commit write the same three creases', () => {
    // The invariant that was already true of every fully-assigned fan, and false
    // of exactly this one: the preview had no colour gate and the commit did.
    const handle = reportedFailureCase();
    for (let index = 0; index < 3; index += 1) {
      const previewed = solve(handle, index).segments;
      expect(previewed).toHaveLength(3);

      const applied = reportedFailureCase();
      execute_cp_command(applied, 'VertexSolveFoldAngles', {
        points: [VERTEX],
        line_ids: CHOSEN,
        candidate_index: index,
      });
      const written = linesOf(applied);
      for (const shown of previewed) {
        expect(
          written.some(
            (line) =>
              line.color === shown.color &&
              (line.fold_magnitude ?? null) === (shown.fold_magnitude ?? null) &&
              Math.hypot(line.a.x - shown.a.x, line.a.y - shown.a.y) < 1e-9 &&
              Math.hypot(line.b.x - shown.b.x, line.b.y - shown.b.y) < 1e-9
          )
        ).toBe(true);
      }
      free_document(applied);
    }
    free_document(handle);
  });

  it('flags the branch that folds the hinted crease the other way, and keeps it', () => {
    // A hint is a belief about the crease, not a fact about the geometry, so it
    // does not remove an answer that genuinely closes the vertex. What it earns
    // is a warning: applying replaces the mark, and nothing afterwards says it
    // was ever there.
    const handle = reportedFailureCase();
    const flags = [0, 1, 2].map((index) => solve(handle, index).candidate_contradicts_hint);
    expect(flags.filter(Boolean)).toHaveLength(1);

    const contradicting = flags.indexOf(true);
    execute_cp_command(handle, 'VertexSolveFoldAngles', {
      points: [VERTEX],
      line_ids: CHOSEN,
      candidate_index: contradicting,
    });
    // Still applied, and applied as a mountain — the branch is real.
    expect(linesOf(handle)[UNASSIGNED - 1]).toMatchObject({ color: 'Red1' });

    free_document(handle);
  });
});

/**
 * Phase 2 parity gate: the transport-driven stroke builder and vertex dedup
 * produce output byte-identical to the structured-snapshot path they replace.
 * Both are exercised on the real-wasm battery so the compact hot path is proven
 * equivalent before Phase 3 removes the structured fetch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  document_geometry,
  document_snapshot,
  free_document,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import {
  vertexPointsFromTransport,
  type CpGeometryTransport,
} from '../../engine/oristudioCpGeometry';
import { initCpWasm, loadBatteryDocument } from '../../engine/oristudioCpTestSupport';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import {
  getCpVertexPoints,
  ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS,
} from '../../lib/creasePatternViewport';
import {
  cpLineStyleDashPatterns,
  cpLineStyleDashSlot,
  HINT_DASH_SLOT,
} from '../../lib/oristudioCpLineStyle';
import type { Rgba } from '../renderer/types';
import type { CpLineAppearance } from './cpLineStyle';
import {
  cpSnapshotToScene,
  translationMatrix,
  type CpSelectionStyle,
  type CpTransformPreview,
} from './cpSnapshotToScene';
import { cpGeometryStrokesToScene } from './cpGeometryToScene';

beforeAll(initCpWasm);

// Deterministic, distinct colour per line-color name (no DOM/theme needed).
function colorFor(name: string): Rgba {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return [(h & 0xff) / 255, ((h >> 8) & 0xff) / 255, ((h >> 16) & 0xff) / 255, 1];
}

// A dashing line style, so the gate covers the dash slots as well as colours.
const LINE_STYLE = 'black-two-dot';
const DASH_PATTERNS = cpLineStyleDashPatterns(LINE_STYLE);
/** `--fold-angle-anchor`; only the `color` mode reads it. */
const ANCHOR: Rgba = [0.851, 0.275, 0.937, 1];

function appearanceFor(name: string): CpLineAppearance {
  return { color: colorFor(name), dashSlot: cpLineStyleDashSlot(LINE_STYLE, name) };
}

function expectStrokesEqual(
  a: ReturnType<typeof cpSnapshotToScene>['strokes'],
  b: ReturnType<typeof cpGeometryStrokesToScene>['strokes']
): void {
  expect(b.count).toBe(a.count);
  expect(Array.from(b.a)).toEqual(Array.from(a.a));
  expect(Array.from(b.b)).toEqual(Array.from(a.b));
  expect(Array.from(b.color)).toEqual(Array.from(a.color));
  expect(Array.from(b.widthMul)).toEqual(Array.from(a.widthMul));
  expect(Array.from(b.dashSlot ?? [])).toEqual(Array.from(a.dashSlot ?? []));
  expect(b.dashPatterns).toEqual(a.dashPatterns);
}

describe('cpGeometryStrokesToScene parity with cpSnapshotToScene', () => {
  let handle: number;
  let structured: OristudioCpDocumentSnapshot;
  let transport: CpGeometryTransport;

  beforeAll(() => {
    handle = loadBatteryDocument();
    structured = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    transport = document_geometry(handle) as CpGeometryTransport;
  });

  afterAll(() => {
    free_document(handle);
  });

  // Every field either builder reads. Hand-projecting it is what lets this gate
  // compare like with like — but it is also how the gate went blind to direction
  // hints: the transport builder read `seg_attr[4]` while this side had no hint
  // to give it. A field added to `CpLineSegmentInput` belongs here too.
  const segmentsInput = () =>
    structured.crease_pattern.line_segments.map((s) => ({
      a: s.a,
      b: s.b,
      color: s.color,
      fold_magnitude: s.fold_magnitude,
      fold_direction_hint: s.fold_direction_hint,
    }));

  /** 1-based ids of the battery's hinted creases. */
  const hintedIds = () =>
    segmentsInput()
      .map((seg, index) => (seg.fold_direction_hint ? index + 1 : 0))
      .filter((id) => id !== 0);

  /**
   * The gate went blind to direction hints once already, by comparing a state no
   * fixture produced. It cannot do that silently again: everything below reads
   * the hinted creases out of the battery, so a battery that stopped carrying
   * them fails here rather than passing vacuously.
   */
  it('the battery actually carries hinted creases', () => {
    expect(hintedIds().length).toBeGreaterThan(1);
    const hints = new Set(segmentsInput().map((seg) => seg.fold_direction_hint));
    expect(hints).toContain('Mountain');
    expect(hints).toContain('Valley');
  });

  it('plain (no selection, no move)', () => {
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS).strokes,
      cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS).strokes
    );
  });

  it('with a selection highlight', () => {
    const selection: CpSelectionStyle = {
      selected: new Set([1, 3, 7, structured.crease_pattern.line_segments.length]),
      color: [0.9, 0.1, 0.2, 1],
      widthMul: 2.5,
    };
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS, selection).strokes,
      cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS, selection).strokes
    );
  });

  it('with creases replaced by a tool preview', () => {
    const replaced = new Set([2, 5]);
    expectStrokesEqual(
      cpSnapshotToScene(
        segmentsInput(),
        appearanceFor,
        DASH_PATTERNS,
        undefined,
        undefined,
        undefined,
        replaced
      ).strokes,
      cpGeometryStrokesToScene(
        transport,
        appearanceFor,
        DASH_PATTERNS,
        undefined,
        undefined,
        undefined,
        replaced
      ).strokes
    );
  });

  it('hides a replaced crease without shifting the ones after it', () => {
    // Zero alpha rather than dropping the segment: the buffers are indexed by
    // segment and those indices are what the selection and transform sets are
    // keyed on, so removing one would silently retarget every id after it.
    const plain = cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS).strokes;
    const hidden = cpGeometryStrokesToScene(
      transport,
      appearanceFor,
      DASH_PATTERNS,
      undefined,
      undefined,
      undefined,
      new Set([2])
    ).strokes;
    expect(hidden.count).toBe(plain.count);
    expect(hidden.color[(2 - 1) * 4 + 3]).toBe(0);
    // Endpoints stay put, and every other crease is untouched.
    expect(Array.from(hidden.a)).toEqual(Array.from(plain.a));
    expect(Array.from(hidden.b)).toEqual(Array.from(plain.b));
    for (let i = 0; i < plain.count; i++) {
      if (i === 1) continue;
      expect(hidden.color.slice(i * 4, i * 4 + 4)).toEqual(plain.color.slice(i * 4, i * 4 + 4));
    }
  });

  it('hides a replaced crease even when it is also selected', () => {
    // The case that matters: the tool's picked creases render *selected*, so a
    // replaced-after-selection order would leave the selection style drawn under
    // the preview — which is the muddiness the whole thing exists to remove.
    const selection: CpSelectionStyle = {
      selected: new Set([2]),
      color: [0.9, 0.1, 0.2, 1],
      widthMul: 2.5,
    };
    const strokes = cpGeometryStrokesToScene(
      transport,
      appearanceFor,
      DASH_PATTERNS,
      selection,
      undefined,
      undefined,
      new Set([2])
    ).strokes;
    expect(strokes.color[(2 - 1) * 4 + 3]).toBe(0);
    expect(strokes.widthMul[1]).toBe(1);
  });

  // Per mode, not once: each builder reads the magnitude from a different place
  // (`segFoldMagnitude` vs the segment object), and the two modes write different
  // channels of the same buffer, so a gate over one mode says nothing about the
  // other.
  for (const display of ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS) {
    const foldAngle = { display, anchor: ANCHOR };

    it(`with the fold-angle treatment applied (${display})`, () => {
      expectStrokesEqual(
        cpSnapshotToScene(
          segmentsInput(),
          appearanceFor,
          DASH_PATTERNS,
          undefined,
          undefined,
          foldAngle
        ).strokes,
        cpGeometryStrokesToScene(
          transport,
          appearanceFor,
          DASH_PATTERNS,
          undefined,
          undefined,
          foldAngle
        ).strokes
      );
    });

    it(`${display} output actually differs from untreated, so the gate is not vacuous`, () => {
      // Also the per-mode guard that no mode is a silent no-op: a dead mode
      // would pass the parity assertion above trivially.
      const plain = cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS).strokes;
      const treated = cpGeometryStrokesToScene(
        transport,
        appearanceFor,
        DASH_PATTERNS,
        undefined,
        undefined,
        foldAngle
      ).strokes;
      expect(Array.from(treated.color)).not.toEqual(Array.from(plain.color));
    });
  }

  it('the two modes differ from each other', () => {
    // They write different channels — hue vs alpha — so if these ever match, one
    // of them has stopped doing its job.
    const byMode = ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS.map(
      (display) =>
        cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS, undefined, undefined, {
          display,
          anchor: ANCHOR,
        }).strokes.color
    );
    expect(Array.from(byMode[0])).not.toEqual(Array.from(byMode[1]));
  });

  it('with an in-progress move-drag delta', () => {
    const selection: CpSelectionStyle = {
      selected: new Set([2, 4]),
      color: [0.1, 0.8, 0.3, 1],
      widthMul: 2,
    };
    const move: CpTransformPreview = {
      ids: new Set([2, 4]),
      matrix: translationMatrix({ x: 12.5, y: -3.25 }),
    };
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS, selection, move).strokes,
      cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS, selection, move).strokes
    );
  });

  it('with an in-progress four-point transform (rotate + scale)', () => {
    const selection: CpSelectionStyle = {
      selected: new Set([2, 4]),
      color: [0.1, 0.8, 0.3, 1],
      widthMul: 2,
    };
    // Non-trivial similarity: 30° rotation scaled by 1.75, plus a translation.
    const c = Math.cos(Math.PI / 6) * 1.75;
    const s = Math.sin(Math.PI / 6) * 1.75;
    const move: CpTransformPreview = {
      ids: new Set([2, 4]),
      matrix: [c, -s, s, c, 3.5, -1.25],
    };
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS, selection, move).strokes,
      cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS, selection, move).strokes
    );
  });

  it('with an in-progress vertex drag (endpoint-level move)', () => {
    const selection: CpSelectionStyle = {
      selected: new Set([2]),
      color: [0.1, 0.8, 0.3, 1],
      widthMul: 2,
    };
    // One end of several creases, including both a `a` and a `b` slot and a
    // crease that is also selected — the combination a real drag produces.
    const move: CpTransformPreview = {
      ids: new Set(),
      endpoints: new Set([0, 3, 4, 2 * 2 + 1]),
      matrix: translationMatrix({ x: -7.75, y: 4.5 }),
    };
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS, selection, move).strokes,
      cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS, selection, move).strokes
    );
  });

  describe('the direction hint, drawn as a second stroke', () => {
    const segmentCount = () => structured.crease_pattern.line_segments.length;

    it('appends one full-strength instance per hinted crease', () => {
      const strokes = cpGeometryStrokesToScene(transport, appearanceFor, DASH_PATTERNS).strokes;
      const hinted = hintedIds();
      expect(strokes.count).toBe(segmentCount() + hinted.length);

      for (const [offset, id] of hinted.entries()) {
        const at = segmentCount() + offset;
        // The direction's own colour, untouched — the whole point of the change
        // away from a wash. And the same line, so it overdraws rather than
        // sitting beside the crease.
        const name = segmentsInput()[id - 1].fold_direction_hint === 'Mountain' ? 'Red1' : 'Blue2';
        expect(strokes.color.slice(at * 4, at * 4 + 4)).toEqual(
          Float32Array.from(appearanceFor(name).color)
        );
        expect(strokes.dashSlot?.[at]).toBe(HINT_DASH_SLOT);
        expect(strokes.a.slice(at * 2, at * 2 + 2)).toEqual(
          strokes.a.slice((id - 1) * 2, (id - 1) * 2 + 2)
        );
        expect(strokes.b.slice(at * 2, at * 2 + 2)).toEqual(
          strokes.b.slice((id - 1) * 2, (id - 1) * 2 + 2)
        );
      }
    });

    it('leaves the crease itself the undecided ink and dash', () => {
      // The hint used to replace the crease's colour. It must not any more —
      // the grey marks are half of what makes the crease read as undecided.
      const withHints = cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS).strokes;
      const stripped = cpSnapshotToScene(
        segmentsInput().map(({ fold_direction_hint: _drop, ...seg }) => seg),
        appearanceFor,
        DASH_PATTERNS
      ).strokes;
      const creases = segmentCount();
      expect(stripped.count).toBe(creases);
      expect(withHints.color.slice(0, creases * 4)).toEqual(stripped.color.slice(0, creases * 4));
      expect(withHints.dashSlot?.slice(0, creases)).toEqual(stripped.dashSlot?.slice(0, creases));
      // ...and the treatment is not a no-op, which is what the assertion above
      // would look like if the overlays had quietly stopped being written.
      expect(withHints.count).toBeGreaterThan(stripped.count);
    });

    it('says nothing for a crease the selection has taken over', () => {
      // A selected crease is drawn solid in the selection colour on purpose, so
      // half of it in mountain red would read as broken geometry.
      const hinted = hintedIds();
      const selection: CpSelectionStyle = {
        selected: new Set(hinted),
        color: [0.9, 0.1, 0.2, 1],
        widthMul: 2.5,
      };
      const strokes = cpGeometryStrokesToScene(
        transport,
        appearanceFor,
        DASH_PATTERNS,
        selection
      ).strokes;
      expect(strokes.count).toBe(segmentCount());
      expectStrokesEqual(
        cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS, selection).strokes,
        strokes
      );
    });

    it('says nothing for a crease a tool preview has replaced', () => {
      const replaced = new Set(hintedIds());
      const strokes = cpGeometryStrokesToScene(
        transport,
        appearanceFor,
        DASH_PATTERNS,
        undefined,
        undefined,
        undefined,
        replaced
      ).strokes;
      expect(strokes.count).toBe(segmentCount());
    });

    it('both builders decline together under a style that inks everything alike', () => {
      // What the black-dot styles do: mountain, valley and undecided all resolve
      // to the same ink, so the overlay would repaint the crease in its own
      // colour. Both builders must drop it, and drop the *same* ones — this is
      // the one thing that makes the instance count depend on the ink.
      const monochrome = (name: string): CpLineAppearance => ({
        color: [0, 0, 0, 1],
        dashSlot: cpLineStyleDashSlot(LINE_STYLE, name),
      });
      const strokes = cpGeometryStrokesToScene(transport, monochrome, DASH_PATTERNS).strokes;
      expect(strokes.count).toBe(segmentCount());
      expectStrokesEqual(
        cpSnapshotToScene(segmentsInput(), monochrome, DASH_PATTERNS).strokes,
        strokes
      );
    });

    it('travels with the crease under a move preview', () => {
      const hinted = hintedIds();
      const move: CpTransformPreview = {
        ids: new Set(hinted),
        matrix: translationMatrix({ x: 12.5, y: -3.25 }),
      };
      const strokes = cpGeometryStrokesToScene(
        transport,
        appearanceFor,
        DASH_PATTERNS,
        undefined,
        move
      ).strokes;
      for (const [offset, id] of hinted.entries()) {
        const at = segmentCount() + offset;
        expect(strokes.a.slice(at * 2, at * 2 + 2)).toEqual(
          strokes.a.slice((id - 1) * 2, (id - 1) * 2 + 2)
        );
      }
      expectStrokesEqual(
        cpSnapshotToScene(segmentsInput(), appearanceFor, DASH_PATTERNS, undefined, move).strokes,
        strokes
      );
    });
  });

  it('vertexPointsFromTransport matches getCpVertexPoints', () => {
    expect(vertexPointsFromTransport(transport)).toEqual(getCpVertexPoints(structured));
  });
});

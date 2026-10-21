import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { CpSheetIndex, type CpSheetIndexTransport } from '../../engine/oristudioCpSheetIndex';
import { ringsMatch } from '../regions/regionReference';
import {
  type CpWasm,
  FIXTURES,
  corpus,
  loadCp,
  loadCpWasm,
  loadFile,
  square,
  wasmAvailable,
  where,
} from '../sheets/sheetsWasmTestSupport';
import {
  referencesFallbackFrames,
  referencesFramesFromIndex,
  referencesSheetLines,
} from './referencesFrames';
import {
  paperFallbackRect,
  precreaseInputFromTransport,
  type PrecreaseComponent,
  type PrecreaseTolerances,
  type SheetAnalysis,
} from './sheetFrames';

/**
 * References' sheets read from the kernel's sheet index, one sheet's detail at a
 * time, against what the precrease planner found by chaining the borders itself
 * and analysing every sheet at once (`sheet_frames`): the same sheets, framed
 * alike, holding the same lines, merged into the same lines with the same
 * exactness — except where the definitions were decided to differ
 * (implementation-plans/large-document-open-and-select.md, "Definitions —
 * decided 2026-10-18"), each named here.
 */
const PRECREASE_WASM = resolve(
  process.cwd(),
  'src/generated/oristudio-precrease-wasm/oristudio_precrease_wasm_bg.wasm'
);
const available = wasmAvailable && existsSync(PRECREASE_WASM);

type PrecreaseWasm =
  typeof import('../../generated/oristudio-precrease-wasm/oristudio_precrease_wasm');

let cpWasm: CpWasm;
let pre: PrecreaseWasm;

const ring = (component: PrecreaseComponent) => component.outline.map(([x, y]) => ({ x, y }));
const sorted = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join();

/**
 * The same value, its numbers to within a billionth. A rectangle turned off the
 * axes is framed along one of its long sides, and the index's outline may start
 * at another corner than the border walk did — the opposite side, whose
 * direction is the same to the last bit or two. Every count, index and verdict
 * still has to match exactly.
 */
function same(a: unknown, b: unknown): boolean {
  return near(settled(a), settled(b));
}

/**
 * Every line's sign settled. `n · p = d` and `-n · p = -d` are one line, and the
 * planner picks between them by the normal's sign — which, for a normal along an
 * axis to within a bit, the last bit of the frame decides. A lattice offset is
 * measured along that normal, so it turns with it.
 */
function settled(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(settled);
  if (!value || typeof value !== 'object') return value;
  const record = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, settled(v)]));
  const line = record.line as { n: [number, number]; d: number } | undefined;
  if (line && Array.isArray(line.n)) {
    const [nx, ny] = line.n;
    if (nx < -1e-9 || (Math.abs(nx) <= 1e-9 && ny < 0)) {
      record.line = { ...line, n: [-nx, -ny], d: -line.d };
      const lattice = record.lattice as { p: number; value: number } | null | undefined;
      if (lattice) record.lattice = { ...lattice, p: -lattice.p, value: -lattice.value };
    }
  }
  return record;
}

function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    // Equal first: a line no lattice reaches is `Infinity` away from it.
    if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => near(value, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) =>
        near((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      )
    );
  }
  return a === b;
}

/** The sheets, both ways, and every way they disagree, in words. */
function compare(handle: number): {
  before: SheetAnalysis;
  after: SheetAnalysis;
  differences: string[];
} {
  const geometry = cpWasm.document_geometry(handle) as CpGeometryTransport;
  const input = precreaseInputFromTransport(geometry);
  const before = pre.sheet_frames(
    input.segments,
    input.colors,
    paperFallbackRect()
  ) as SheetAnalysis;

  const index = new CpSheetIndex(cpWasm.sheet_index(handle) as CpSheetIndexTransport);
  const tolerances = pre.precrease_tolerances() as PrecreaseTolerances;
  const hasBorder = input.colors.some((color) => color === 0);
  const after =
    index.sheetCount === 0 && !hasBorder
      ? referencesFallbackFrames(geometry, paperOutline(), tolerances)
      : referencesFramesFromIndex(
          index,
          geometry,
          pre.outline_components(
            index.transport.outlineCoords,
            index.transport.outlineOffsets
          ) as PrecreaseComponent[],
          tolerances
        );

  const differences: string[] = [];
  for (const old of before.components) {
    const listed = after.components.find((sheet) => ringsMatch(ring(sheet), ring(old)));
    if (!listed) {
      differences.push(`${old.refused?.kind ?? 'sheet'} ${where(ring(old))} is not listed`);
      continue;
    }
    const lines = referencesSheetLines(geometry, listed);
    const detail = (
      pre.sheet_component(
        listed.id,
        lines.outline,
        lines.segments,
        lines.colors,
        lines.indices
      ) as SheetAnalysis
    ).components[0]!;
    const at = where(ring(old));
    if (!near(detail.frame, old.frame)) differences.push(`${at}: another frame`);
    if (detail.refused?.kind !== old.refused?.kind) {
      differences.push(
        `${at}: refused ${detail.refused?.kind ?? 'no'}, was ${old.refused?.kind ?? 'no'}`
      );
    }
    if (sorted(listed.border_segment_indices) !== sorted(old.border_segment_indices)) {
      differences.push(`${at}: another border`);
    }
    if (sorted(detail.segment_indices) !== sorted(old.segment_indices)) {
      differences.push(
        `${at}: ${detail.segment_indices.length} creases, was ${old.segment_indices.length}`
      );
    }
    if (sorted(detail.aux_segment_indices) !== sorted(old.aux_segment_indices)) {
      differences.push(
        `${at}: ${detail.aux_segment_indices.length} aux lines, was ${old.aux_segment_indices.length}`
      );
    }
    if (!same(detail.merged_lines, old.merged_lines)) differences.push(`${at}: other merged lines`);
    if (!same(detail.exactness, old.exactness)) differences.push(`${at}: another exactness`);
  }
  for (const sheet of after.components) {
    if (!before.components.some((old) => ringsMatch(ring(old), ring(sheet)))) {
      differences.push(`sheet ${where(ring(sheet))} was not one`);
    }
  }
  return { before, after, differences };
}

function paperOutline(): PrecreaseComponent {
  const [x0, y0, x1, y1] = paperFallbackRect();
  const [paper] = pre.outline_components(
    Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1]),
    Uint32Array.from([0, 4])
  ) as PrecreaseComponent[];
  return paper!;
}

function cp(...lines: string[]): number {
  return loadCp(cpWasm, ...lines);
}

describe.skipIf(!available)('References sheets from the index, against the planner’s own', () => {
  beforeAll(async () => {
    cpWasm = await loadCpWasm();
    pre = await import('../../generated/oristudio-precrease-wasm/oristudio_precrease_wasm');
    pre.initSync({ module: readFileSync(PRECREASE_WASM) });
  });

  it.each([
    [
      'two separate squares',
      () => cp(...square(0, 0, 40), '2 0 0 40 40', ...square(100, 0, 40), '3 100 0 140 40'),
    ],
    [
      'aux lines on a sheet',
      () => cp(...square(0, 0, 40), '4 10 0 10 40', '4 0 20 40 20', '2 0 0 40 40'),
    ],
    [
      'a square turned 45°',
      () => cp('1 0 -20 20 0', '1 20 0 0 20', '1 0 20 -20 0', '1 -20 0 0 -20', '2 -20 0 20 0'),
    ],
    ['no border at all', () => cp('2 -100 -100 100 100', '3 -100 100 100 -100')],
  ])('%s: the same sheets, the same lines and the same verdicts', (_, load) => {
    expect(compare(load()).differences).toEqual([]);
  });

  it.each([
    ['oriedita/solution_sample_1.cp'],
    ['flat-folder/kabuto.fold'],
    ['fold-angle-3d/box_90.fold'],
    ['precrease/hex-14.fold'],
    ['precrease/iguana-c0.fold'],
    ['precrease/grid6.fold'],
    ['precrease/x13_x38.fold'],
    ['precrease/divergence-1.cp'],
  ])('fixture %s: the same sheets, the same lines and the same verdicts', (file) => {
    const result = compare(loadFile(cpWasm, resolve(FIXTURES, file)));
    expect(result.after.components.length).toBeGreaterThan(0);
    expect(result.differences).toEqual([]);
  });

  // The definitions decided to differ: a border line inside a sheet is one of
  // its lines, never a reason to refuse it; a border that does not close is no
  // sheet.
  it('a border wall across a sheet no longer refuses it', () => {
    const result = compare(
      cp(
        '1 0 0 40 0',
        '1 40 0 80 0',
        '1 80 0 80 40',
        '1 80 40 40 40',
        '1 40 40 0 40',
        '1 0 40 0 0',
        '1 40 0 40 40',
        '2 0 0 40 40'
      )
    );
    // The planner refused the walled sheet outright; now it is framed and its
    // crease planned, the wall kept with its border.
    expect(result.differences).toEqual([
      '[0,0..80,40]: another frame',
      '[0,0..80,40]: refused no, was non_simple_outline',
      '[0,0..80,40]: 1 creases, was 0',
      '[0,0..80,40]: other merged lines',
      '[0,0..80,40]: another exactness',
    ]);
    const [sheet] = result.after.components;
    expect(sheet?.frame).not.toBeNull();
    expect(sheet?.border_segment_indices).toHaveLength(7);
  });

  it('a border that does not close is not listed', () => {
    const result = compare(cp('1 0 0 40 0', '1 40 0 40 40', '2 0 0 40 40'));
    expect(result.differences).toEqual(['open_outline [0,0..40,40] is not listed']);
    expect(result.after.components).toEqual([]);
    expect(result.after.warnings).toEqual([{ kind: 'unassigned_segments', count: 1 }]);
  });

  // Reflect selection over line with its axis's second point clicked on its
  // first. The kernel used to mirror across that point and append a crease
  // with every coordinate NaN, and the planner, handed the whole pattern,
  // answered "coordinate 20 is not finite" for every sheet on the canvas.
  it('reflecting the selection across one point adds nothing the planner rejects', () => {
    const handle = cp(...square(0, 0, 40), '2 10 0 10 40');
    cpWasm.execute_cp_command(handle, 'DrawCreaseSymmetric', {
      line_ids: [5],
      points: [
        { x: 20, y: 0 },
        { x: 20, y: 0 },
      ],
    });
    const geometry = cpWasm.document_geometry(handle) as CpGeometryTransport;
    const input = precreaseInputFromTransport(geometry);
    expect(() => pre.sheet_frames(input.segments, input.colors, paperFallbackRect())).not.toThrow();
    expect(geometry.segEndpoints).toHaveLength(5 * 4);
    expect(compare(handle).differences).toEqual([]);
  });

  // Such a crease is still in files written before the kernel refused it: the
  // .cp export wrote it as `NaN`, and Oriedita, which mirrors across the point
  // too, writes it the same way. It is left out, and every sheet is still read.
  it.each([
    ['on a sheet', () => cp(...square(0, 0, 40), '2 10 0 10 40', '2 NaN NaN NaN NaN')],
    ['on the default paper', () => cp('2 10 0 10 40', '2 NaN NaN NaN NaN', '3 0 0 40 40')],
  ])('a crease with no position %s is left out and said so', (_, load) => {
    const handle = load();
    const geometry = cpWasm.document_geometry(handle) as CpGeometryTransport;
    const index = new CpSheetIndex(cpWasm.sheet_index(handle) as CpSheetIndexTransport);
    const tolerances = pre.precrease_tolerances() as PrecreaseTolerances;
    const analysis =
      index.sheetCount === 0
        ? referencesFallbackFrames(geometry, paperOutline(), tolerances)
        : referencesFramesFromIndex(
            index,
            geometry,
            pre.outline_components(
              index.transport.outlineCoords,
              index.transport.outlineOffsets
            ) as PrecreaseComponent[],
            tolerances
          );
    expect(analysis.components).toHaveLength(1);
    for (const sheet of analysis.components) {
      const lines = referencesSheetLines(geometry, sheet);
      const detail = pre.sheet_component(
        sheet.id,
        lines.outline,
        lines.segments,
        lines.colors,
        lines.indices
      ) as SheetAnalysis;
      expect(detail.components[0]?.frame).not.toBeNull();
    }
    // Not a crease outside every sheet: a crease with nowhere to be.
    expect(analysis.unassigned_segments).toEqual([]);
    expect(analysis.warnings).toContainEqual({ kind: 'non_finite_segments', count: 1 });
  });

  it.skipIf(corpus.length === 0).each(corpus)(
    'corpus %s: the same sheets, the same lines and the same verdicts',
    (file) => {
      const result = compare(loadFile(cpWasm, file));
      console.log(`${file}: ${result.after.components.length} sheets`);
      expect(result.differences).toEqual([]);
    },
    600_000
  );
});

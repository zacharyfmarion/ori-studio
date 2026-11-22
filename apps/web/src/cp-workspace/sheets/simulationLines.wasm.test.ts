import { beforeAll, describe, expect, it } from 'vitest';
import { AUX_LINES_KEY, auxLinesOf, prepareFoldModel } from '@treemaker/origami-simulator';
import { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import { foldArtifactsSimulating } from '../../lib/creasePatternImport';
import { buildSegmentSimulationFold, wholeFoldSegment } from '../../lib/creasePatternSegmentation';
import { foldScaledForSolver } from '../../simulator/simulatorSession';
import { sheetArtifactsFromFold } from './cpSheetArtifacts';
import { documentHasAuxLines, splitSimulationLines } from './simulationLines';
import { type CpWasm, loadCp, loadCpWasm, square, wasmAvailable } from './sheetsWasmTestSupport';

/**
 * The fold a sheet is simulated from, through the real kernel: the bug that
 * started this (`aux_crease_simulation_issue.fold`) in miniature — a square
 * with one valley across its diagonal and aux lines across both halves — is
 * two triangles, with the aux lines drawn on them rather than cut into them.
 */
let wasm: CpWasm;

beforeAll(async () => {
  if (wasmAvailable) wasm = await loadCpWasm();
});

/** What `simulationSourceFold` builds, against the raw kernel rather than its client. */
function sheetSimulation(handle: number, auxLinesAreFacets: boolean) {
  const document = wasm.document_snapshot(handle) as OristudioCpDocumentSnapshot;
  const index = new CpSheetIndex(wasm.sheet_index(handle));
  const ids = [...index.lines(0)];
  const base = sheetArtifactsFromFold(
    JSON.parse(wasm.export_fold_lines(handle, ids)) as FoldDocument,
    0
  );
  const { paper, aux } = splitSimulationLines(document, ids, auxLinesAreFacets);
  const source =
    aux.length === 0
      ? base.fold
      : { ...(JSON.parse(wasm.export_fold_lines(handle, paper)) as FoldDocument), [AUX_LINES_KEY]: aux };
  const artifacts = { ...foldArtifactsSimulating(base.fold, source), segments: base.segments };
  const fold = buildSegmentSimulationFold(artifacts, wholeFoldSegment(artifacts.fold, 0));
  return {
    document,
    artifacts,
    prepared: prepareFoldModel(foldScaledForSolver(fold), { triangulate: true, auxLines: true }),
  };
}

const AUX = [
  '4 0 100 200 100',
  '4 100 0 100 200',
  '4 20 180 180 20',
  // A tick off the border, ending inside one half.
  '4 200 50 150 50',
];

describe.skipIf(!wasmAvailable)('a sheet simulated from its fold lines', () => {
  it('is two triangles whatever aux lines are drawn on it', () => {
    const handle = loadCp(wasm, ...square(0, 0, 200), '3 0 0 200 200', ...AUX);
    const { prepared, document } = sheetSimulation(handle, false);

    expect(documentHasAuxLines(document)).toBe(true);
    expect(prepared.vertexCount).toBe(4);
    expect(prepared.faceCount).toBe(2);
    // No hinge but the valley: nothing source-flat, no diagonal.
    expect(prepared.edgesAssignment.filter((a) => a === 'F')).toEqual([]);
    expect(prepared.creaseParams).toHaveLength(1);
    // Every aux line rides the paper, cut where it crosses the valley.
    expect(prepared.auxOverlay?.triangles.length).toBeGreaterThanOrEqual(AUX.length);
  });

  it('keeps the base fold as drawn, aux lines included, for segmentation and export', () => {
    const handle = loadCp(wasm, ...square(0, 0, 200), '3 0 0 200 200', ...AUX);
    const { artifacts } = sheetSimulation(handle, false);

    expect(artifacts.fold.edges_assignment?.filter((a) => a === 'F').length).toBeGreaterThan(0);
    expect(auxLinesOf(artifacts.simulation_model!.fold as FoldDocument)).toHaveLength(AUX.length);
  });

  it('builds the aux lines in as facets when the document says they are', () => {
    const handle = loadCp(wasm, ...square(0, 0, 200), '3 0 0 200 200', ...AUX);
    const { prepared } = sheetSimulation(handle, true);

    expect(prepared.faceCount).toBeGreaterThan(2);
    expect(prepared.auxOverlay).toBeUndefined();
  });

  it('is the base fold itself for a sheet with no aux lines', () => {
    const handle = loadCp(wasm, ...square(0, 0, 200), '3 0 0 200 200');
    const { artifacts, document } = sheetSimulation(handle, false);

    expect(documentHasAuxLines(document)).toBe(false);
    expect(artifacts.simulation_model?.fold[AUX_LINES_KEY]).toBeUndefined();
  });
});

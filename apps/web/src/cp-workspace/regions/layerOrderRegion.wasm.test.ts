/**
 * The crease pattern a Layer order fold came from, on a document of many, as
 * the real kernel indexes its sheets: a three-by-three grid of patterns, each
 * a square with a valley fold down its middle and an aux line across it, as
 * a document of many small crease patterns is. Every host finds the same one:
 * Edit's figure and selection by the lines they fold
 * (`layerOrderRegionOfLines`), a Diagram step and Pose by the sheet they link
 * (`chooseRegionCreases`, then `layerOrderRegionOf`). It is that pattern
 * alone — its paper, its own aux lines — and the faces the kernel folds from
 * it lie on that paper, so the dialog's tints, letters and picks land where
 * the pane draws it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CpSheetIndex, type CpSheetIndexTransport } from '../../engine/oristudioCpSheetIndex';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { ringsBounds } from '../../layer-order/panes/layerPaneFigure';
import type { LayerOrderRegion } from '../../lib/layerOrder/layerOrderRequest';
import { sheetRegions } from '../sheets/cpSheetRegions';
import { type CpWasm, loadCp, loadCpWasm, wasmAvailable } from '../sheets/sheetsWasmTestSupport';
import { layerOrderRegionOf, layerOrderRegionOfLines } from './layerOrderRegion';
import { chooseRegionCreases } from './regionCreases';
import { regionReferenceFor } from './regionReference';

const sheets = vi.hoisted(() => ({ index: null as CpSheetIndex | null }));
vi.mock('../sheets/cpSheetIndex', () => ({
  peekCpSheetIndex: () => sheets.index,
  ensureCpSheetIndex: async () => sheets.index,
}));

/**
 * One pattern of the grid, its corner at (x, y): a 40-unit square, a valley
 * down its middle (its top and bottom edges split where it meets them), an
 * aux line across.
 */
function pattern(x: number, y: number): string[] {
  const [left, middle, right, top, bottom] = [x, x + 20, x + 40, y, y + 40];
  return [
    `1 ${left} ${top} ${middle} ${top}`,
    `1 ${middle} ${top} ${right} ${top}`,
    `1 ${right} ${top} ${right} ${bottom}`,
    `1 ${right} ${bottom} ${middle} ${bottom}`,
    `1 ${middle} ${bottom} ${left} ${bottom}`,
    `1 ${left} ${bottom} ${left} ${top}`,
    `3 ${middle} ${top} ${middle} ${bottom}`,
    `4 ${left} ${y + 10} ${right} ${y + 10}`,
  ];
}

const GRID = [0, 1, 2].flatMap((row) => [0, 1, 2].flatMap((column) => pattern(column * 60 - 90, row * 60 - 90)));

let wasm: CpWasm;
let handle: number;
let document: OristudioCpDocumentSnapshot;
let index: CpSheetIndex;

/** The sheet in the middle of the grid, by its bounds. */
function middleSheet(): number {
  const regions = sheetRegions(index);
  const middle = regions.find(({ bounds }) => bounds.minX < 0 && bounds.maxX > 0 && bounds.minY < 0 && bounds.maxY > 0);
  if (!middle) throw new Error('no sheet in the middle of the grid');
  return middle.id;
}

const colourOf = (id: number) => document.crease_pattern.line_segments[id - 1]!.color;
const paperBox = (region: LayerOrderRegion) => ringsBounds(region.paper)!;

describe.skipIf(!wasmAvailable)('the region a Layer order fold came from, on a document of many patterns', () => {
  beforeAll(async () => {
    wasm = await loadCpWasm();
    handle = loadCp(wasm, ...GRID);
    document = wasm.document_snapshot(handle) as OristudioCpDocumentSnapshot;
    index = new CpSheetIndex(wasm.sheet_index(handle) as CpSheetIndexTransport);
    sheets.index = index;
  });

  it('is the one pattern its lines lie on, framed on its paper, with its own aux lines only', async () => {
    expect(index.sheetCount).toBe(9);
    const sheet = middleSheet();
    const region = (await layerOrderRegionOfLines(document, index.lines(sheet)))!;
    expect(paperBox(region)).toEqual(index.bounds(sheet));
    // Its own aux lines, and none of the other eight patterns'.
    const ownAux = index.lines(sheet).filter((id) => colourOf(id) === 'Cyan3');
    expect(ownAux.length).toBeGreaterThan(0);
    expect(region.auxSegments).toEqual(ownAux.map((id) => document.crease_pattern.line_segments[id - 1]));
    const allAux = document.crease_pattern.line_segments.filter((line) => line.color === 'Cyan3');
    expect(allAux.length).toBe(9 * ownAux.length);
  });

  it('is the same from the creases a selection folds alone, aux lines left out, or only some of them', async () => {
    const sheet = middleSheet();
    const whole = await layerOrderRegionOfLines(document, index.lines(sheet));
    const creases = index.lines(sheet).filter((id) => colourOf(id) !== 'Cyan3');
    expect(await layerOrderRegionOfLines(document, creases)).toEqual(whole);
    expect(await layerOrderRegionOfLines(document, creases.slice(0, 2))).toEqual(whole);
  });

  it('is none for lines across two patterns, or none at all', async () => {
    const [first, second] = [index.lines(0), index.lines(1)];
    expect(await layerOrderRegionOfLines(document, [...first, ...second])).toBeNull();
    expect(await layerOrderRegionOfLines(document, [])).toBeNull();
  });

  it('is what a Diagram step linked to that pattern has, and Pose with it', async () => {
    const sheet = middleSheet();
    const choice = chooseRegionCreases(
      document,
      { kind: 'segment', region: regionReferenceFor(sheetRegions(index)[sheet]!) },
      index
    );
    if (choice.status !== 'found') throw new Error(`the step found no creases: ${choice.status}`);
    expect(layerOrderRegionOf(document, choice.creases)).toEqual(await layerOrderRegionOfLines(document, index.lines(sheet)));
  });

  it('holds every face the kernel folds from it, so marks on the faces land on the pane’s pattern', async () => {
    const sheet = middleSheet();
    const region = (await layerOrderRegionOfLines(document, index.lines(sheet)))!;
    const folded = wasm.folded_figure_fold_selected(handle, [...index.lines(sheet)], 1, 'Order5', null, 0) as OristudioCpFoldedFigureResult;
    const scene = wasm.folded_figure_paper_scene(folded.handle) as OristudioCpFoldedPaperScene;
    wasm.free_folded_figure(folded.handle);
    const paper = paperBox(region);
    expect(scene.faces.length).toBe(2);
    for (const face of scene.faces) {
      for (const point of face.points.map((at) => scene.sheet_points[at]!)) {
        expect(point.x).toBeGreaterThanOrEqual(paper.minX - 1e-9);
        expect(point.x).toBeLessThanOrEqual(paper.maxX + 1e-9);
        expect(point.y).toBeGreaterThanOrEqual(paper.minY - 1e-9);
        expect(point.y).toBeLessThanOrEqual(paper.maxY + 1e-9);
      }
    }
  });
});

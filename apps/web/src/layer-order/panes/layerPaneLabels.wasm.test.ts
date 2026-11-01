/**
 * What placing the letters costs per frame of the camera on a real figure
 * (`placeLabels`, `layerPaneLabels.ts`): iguana-c0, folded by the CP kernel in
 * this process, with a dozen letters that must show on faces too small to hold
 * them, so every one is set beside its face and looks for a spot clear of the
 * pane's lines. On the folded paper under X-ray, where the paper draws every
 * face's outline, hundreds of them over one another, and on the crease
 * pattern, at Fit and zoomed out to half and a quarter of it.
 *
 * The bound is per call, the median of several, against the same placing
 * with no lines in the same run. Indexing the same outline once per face drawn
 * over it, and testing a line once per cell of the grid it is in, cost 25 to
 * 96 ms a placing on the folded paper here and 2 to 12 on the crease pattern;
 * now each is under a millisecond.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureResult, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import {
  folded_figure_fold,
  folded_figure_paper_scene,
  free_document,
  free_folded_figure,
  load_fold_file,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import type { Point } from '../../lib/geometry';
import { foldedOutlinesOf, foldedPaneLines, paneFacesOf, ringArea, ringsBounds, type LayerPaneSegment } from './layerPaneFigure';
import {
  foldedLabelIndex,
  labelLineIndex,
  patternLabelIndex,
  placeLabels,
  type LayerLabelLines,
  type LayerLabelSpots,
  type LayerPaneLabel,
} from './layerPaneLabels';

const CP_WASM = resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const FIXTURES = resolve(process.cwd(), '../../tests/fixtures');

/** The dialog's pane at the check's window size, and how much of it Fit fills. */
const PANE = { width: 507, height: 784 };
const FIT_FILL = 0.7;
const LETTERS = 12;
/**
 * What one placing of the dozen letters may cost, at the median: so many times
 * what it costs with no lines, measured in the same run, so a slow runner
 * slows both. Before the lines were indexed once each and each look met a
 * line once, they cost 7 to 300 times as much; now at most about 3.
 */
const BOUND_TIMES_BARE = 5;

/** The placing at `zoom` cost `ms`, and `bare` with no lines: within the bound. */
function within(zoom: number, ms: number, bare: number) {
  expect(ms, `zoom ${zoom}: ${ms.toFixed(3)} ms against ${bare.toFixed(3)} with no lines`).toBeLessThan(BOUND_TIMES_BARE * bare);
}

let scene: OristudioCpFoldedPaperScene;

/** The camera at Fit over `rings` (the pane's frame), zoomed out by `zoom`: the figure centred, `FIT_FILL` of the pane. */
function camera(rings: readonly (readonly Point[])[], zoom: number): (point: Point) => Point {
  const bounds = ringsBounds(rings)!;
  const [width, height] = [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY];
  const scale = FIT_FILL * Math.min(PANE.width / width, PANE.height / height) * zoom;
  const [mx, my] = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  return ({ x, y }) => ({ x: PANE.width / 2 + (x - mx) * scale, y: PANE.height / 2 - (y - my) * scale });
}

/** The `LETTERS` smallest faces' letters, all of which must show. */
function smallest(rings: readonly (readonly Point[])[]): LayerPaneLabel[] {
  return rings
    .map((ring, face) => ({ face, area: Math.abs(ringArea(ring)) }))
    .filter(({ area }) => area > 0)
    .sort((a, b) => a.area - b.area || a.face - b.face)
    .slice(0, LETTERS)
    .map(({ face }) => ({ face, tone: 'pick', keep: true }));
}

/** The median of `runs` placings, ms, and the last placing. */
function timed(
  labels: readonly LayerPaneLabel[],
  spotsOf: (face: number) => LayerLabelSpots | null,
  project: (point: Point) => Point,
  lines: LayerLabelLines | null,
  runs = 15
) {
  const letter = (face: number) => `F${face}`;
  const place = () => placeLabels(labels, spotsOf, letter, project, { frame: PANE, linePx: 1.5, lines });
  for (let k = 0; k < 3; k += 1) place();
  const times: number[] = [];
  let placed = place();
  for (let k = 0; k < runs; k += 1) {
    const start = performance.now();
    placed = place();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { ms: times[Math.floor(times.length / 2)]!, placed };
}

describe.skipIf(!existsSync(CP_WASM))('what placing the letters costs on iguana-c0', () => {
  beforeAll(async () => {
    await initCpWasm();
    const document = load_fold_file(readFileSync(resolve(FIXTURES, 'precrease/iguana-c0.fold'), 'utf8'));
    const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
    const drawn = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
    free_folded_figure(result.handle);
    free_document(document);
    if (!drawn) throw new Error('iguana-c0: the kernel drew nothing');
    scene = drawn;
  }, 600_000);

  it('on the folded paper under X-ray: a dozen letters beside their faces, at Fit and zoomed out', () => {
    const outlines = foldedOutlinesOf(scene);
    const lines = labelLineIndex(foldedPaneLines(scene, true, true));
    const labels = smallest(outlines);
    const spotsOf = foldedLabelIndex(scene);
    const rows: string[] = [];
    for (const zoom of [1, 0.5, 0.25]) {
      const project = camera(outlines, zoom);
      const { ms, placed } = timed(labels, spotsOf, project, lines);
      const bare = timed(labels, spotsOf, project, null).ms;
      rows.push(
        `folded, X-ray, ${zoom === 1 ? 'Fit' : `${zoom} of Fit`}: ${ms.toFixed(3)} ms, ${bare.toFixed(3)} with no lines; ${placed.filter((l) => l.off).length} of ${placed.length} beside`
      );
      expect(placed.filter((label) => label.off).length, `zoom ${zoom}`).toBeGreaterThanOrEqual(LETTERS - 2);
      within(zoom, ms, bare);
    }
    console.info(rows.join('\n'));
  });

  it('on the crease pattern: a dozen letters beside their faces, at Fit and zoomed out', () => {
    const rows = patternCosts('crease pattern', scene, within);
    console.info(rows.join('\n'));
  });
});

/**
 * The crease pattern's cost on `scene`: per zoom, a dozen letters placed with
 * the pattern's lines and with none (what placing cost before the lines), each
 * checked by `check`. The pattern's lines are every side of every face, which
 * the index takes once each.
 */
function patternCosts(
  name: string,
  folded: OristudioCpFoldedPaperScene,
  check: (zoom: number, ms: number, bare: number) => void
): string[] {
  const { pattern } = paneFacesOf(folded);
  const sides: LayerPaneSegment[] = pattern.flatMap((ring) => ring.map((p, i): LayerPaneSegment => [p, ring[(i + 1) % ring.length]!]));
  const lines = labelLineIndex(sides);
  const labels = smallest(pattern);
  const spotsOf = patternLabelIndex(pattern);
  return [1, 0.5, 0.25].map((zoom) => {
    const project = camera(pattern, zoom);
    const { ms, placed } = timed(labels, spotsOf, project, lines);
    const bare = timed(labels, spotsOf, project, null).ms;
    expect(placed.filter((label) => label.off).length, `${name}, zoom ${zoom}`).toBeGreaterThanOrEqual(LETTERS - 2);
    check(zoom, ms, bare);
    const at = zoom === 1 ? 'Fit' : `${zoom} of Fit`;
    return `${name} (${sides.length} sides), ${at}: ${ms.toFixed(3)} ms, ${bare.toFixed(3)} with no lines; ${placed.filter((l) => l.off).length} of ${placed.length} beside`;
  });
}

/**
 * Real designers' crease patterns, never committed: `LAYER_ORDER_CORPUS` names
 * their `.fold` files, comma-separated (the cpoogle corpus's `truth.fold`).
 * Reports each one's cost and checks nothing but that it was measured.
 */
const CORPUS = (process.env.LAYER_ORDER_CORPUS ?? '').split(',').filter((path) => path !== '');

describe.skipIf(!existsSync(CP_WASM) || CORPUS.length === 0)('what placing the letters costs on a real crease pattern', () => {
  it('a dozen letters beside their faces on each, at Fit and zoomed out', async () => {
    await initCpWasm();
    const rows: string[] = [];
    for (const path of CORPUS) {
      const name = path.split('/').at(-2) ?? path;
      const document = load_fold_file(readFileSync(path, 'utf8'));
      try {
        const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
        const drawn = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
        free_folded_figure(result.handle);
        if (drawn) rows.push(...patternCosts(name, drawn, () => undefined));
        else rows.push(`${name}: the kernel drew nothing`);
      } catch (error) {
        rows.push(`${name}: did not fold (${String(error).slice(0, 80)})`);
      } finally {
        free_document(document);
      }
    }
    console.info(rows.join('\n'));
    expect(rows.length).toBeGreaterThan(0);
  }, 600_000);
});

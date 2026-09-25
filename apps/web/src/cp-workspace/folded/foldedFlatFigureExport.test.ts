/**
 * The flat figure's export page, on a real fold: the Oriedita solution sample
 * folded by the wasm kernel in this process, its paper scene painted through
 * the export dialog's target at the figure's on-screen size.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import {
  folded_figure_fold,
  folded_figure_paper_scene,
  free_document,
  free_folded_figure,
  load_cp,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { DEFAULT_PAPER_PAGE, type PaperPage } from '../../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { pageMarginPt, PT_PER_CSS_PX } from '../../lib/paper/paperSvg';
import {
  paintPaperExport,
  paperExportPage,
  paperExportSceneInput,
} from '../../paperExport/paperExportSession';
import { foldedFigureUserPerModelUnit } from '../adapters/cpFoldedToScene';
import {
  foldedFigureExportPicture,
  foldedFigureExportTarget,
  type FoldedFigureExportPicture,
} from './foldedFigureExportTarget';
import { foldedFlatFigureExportsScene, foldedFlatFigureScenePxPerUnit } from './foldedFlatFigureExport';

const FIXTURES = resolve(process.cwd(), '../../tests/fixtures');

let document = 0;
let handle = 0;
let snapshot: OristudioCpFoldedFigureSnapshot;
let kernel: OristudioCpFoldedPaperScene;

beforeAll(async () => {
  await initCpWasm();
  document = load_cp(
    readFileSync(resolve(FIXTURES, 'oriedita/solution_sample_1.cp'), 'utf8'),
    'sample'
  );
  const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
  handle = result.handle;
  snapshot = result.snapshot;
  const scene = folded_figure_paper_scene(handle) as OristudioCpFoldedPaperScene | null;
  if (!scene) throw new Error('the kernel drew nothing');
  kernel = scene;
});

afterAll(() => {
  free_folded_figure(handle);
  free_document(document);
});

function figure(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  return {
    id: 'flat-1',
    title: 'Folded model 1',
    handle,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot,
    folded3d: null,
    renderSnapshot: null,
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: null,
    frameRadius: null,
    error: null,
    ...overrides,
  };
}

const TIGHT: PaperPage = { ...DEFAULT_PAPER_PAGE, paddingMm: 0 };

function target(entry: OristudioCpFoldedFigureEntry, picture: FoldedFigureExportPicture) {
  return foldedFigureExportTarget({
    figure: entry,
    picture,
    title: 'Export Folded model 1',
    fileStem: 'sample Folded model 1',
    exportStyle: DEFAULT_PAPER_STYLE,
    storedSceneHint: '',
  });
}

/** The page the export dialog paints for the figure, as it paints it: the scene its target builds for `page`. */
async function paint(entry = figure(), page = TIGHT, cssPerUserUnit = 1) {
  const picture = foldedFigureExportPicture(entry, { model: null, aux: null, kernel, cssPerUserUnit });
  expect(picture?.kind).toBe('flat');
  const exported = target(entry, picture!);
  const options = { ...page, format: 'svg' as const };
  const scene = await exported.buildScene(
    paperExportSceneInput(exported, DEFAULT_PAPER_STYLE, options)
  );
  return scene && paintPaperExport(exported, scene, DEFAULT_PAPER_STYLE, paperExportPage(exported, options));
}

/** The artwork's width in pt, the margin taken off. */
function artworkWidthPt(page: PaperPage, widthPt: number): number {
  return widthPt - 2 * pageMarginPt(DEFAULT_PAPER_STYLE, page);
}

describe('foldedFlatFigureExportsScene', () => {
  it('is a solved flat figure with a live handle in a paper display style', () => {
    expect(snapshot.outcome).toBe('Solved');
    expect(foldedFlatFigureExportsScene(figure())).toBe(true);
    // A solved figure the user views as X-ray still has its paper picture.
    expect(foldedFlatFigureExportsScene(figure({ displayStyle: 'Transparent3' }))).toBe(true);
    expect(foldedFlatFigureExportsScene(figure({ handle: null }))).toBe(false);
    expect(foldedFlatFigureExportsScene(figure({ displayStyle: 'Wire2' }))).toBe(false);
    expect(foldedFlatFigureExportsScene(figure({ displayStyle: 'None0' }))).toBe(false);
    expect(
      foldedFlatFigureExportsScene(
        figure({ folded3d: {} as NonNullable<OristudioCpFoldedFigureEntry['folded3d']> })
      )
    ).toBe(false);
  });

  it('keeps the stored picture for a fold with no layer ordering', () => {
    // The kernel parks a search that found no solutions, or hit a
    // contradiction, at `Transparent3` — the same style a user can pick on a
    // solved figure. Only the outcome tells them apart, and only a solved
    // fold has a `Paper5` picture: asking the kernel for the other's would
    // repeat the failed search or re-raise the contradiction.
    for (const outcome of ['NoSolutions', 'Contradiction'] as const) {
      const unordered = figure({
        displayStyle: 'Transparent3',
        snapshot: { ...snapshot, display_style: 'Transparent3', outcome },
      });
      expect(foldedFlatFigureExportsScene(unordered)).toBe(false);
    }
    // A figure whose fold predates `outcome` never has a live handle without
    // a re-fold, but the predicate does not guess for it either.
    expect(
      foldedFlatFigureExportsScene(figure({ snapshot: { ...snapshot, outcome: undefined } }))
    ).toBe(false);
    expect(foldedFlatFigureExportsScene(figure({ snapshot: null }))).toBe(false);
  });
});

describe('the flat figure’s export page', () => {
  it('paints every face of the fold as a page in points', async () => {
    const page = (await paint())!;
    expect(page).not.toBeNull();
    expect(page.svg).toMatch(/^<\?xml[^]*<svg [^>]*width="[\d.]+pt"/);
    // One polygon per face: the sample stacks acyclically, so no face is split.
    expect(page.svg.match(/<polygon /g)).toHaveLength(kernel.faces.length);
    expect(page.svg).toContain(`fill="${DEFAULT_PAPER_STYLE.paper.front}"`);
    expect(page.svg).toContain(`stroke="${DEFAULT_PAPER_STYLE.edges.color}"`);
  });

  it('is the figure at its on-screen size: kernel units through the paper affine and the placement', async () => {
    const extent = Math.max(...kernel.faces.flatMap((face) => face.outline.map((p) => p.x)));
    const origin = Math.min(...kernel.faces.flatMap((face) => face.outline.map((p) => p.x)));
    const widthPt = artworkWidthPt(TIGHT, (await paint())!.widthPt);
    const perUnit = foldedFlatFigureScenePxPerUnit(figure());
    expect(perUnit).toBeCloseTo(foldedFigureUserPerModelUnit(figure()), 12);
    expect(widthPt).toBeCloseTo((extent - origin) * perUnit * PT_PER_CSS_PX, 1);

    // A canvas at 200% doubles it; so does a placement at scale 2. The
    // placement's turn and offset are not a standalone image's.
    expect(artworkWidthPt(TIGHT, (await paint(figure(), TIGHT, 2))!.widthPt)).toBeCloseTo(
      widthPt * 2,
      1
    );
    const placed = figure({
      placement: { offset: { x: 500, y: -200 }, scale: 2, rotation: 0.7 },
    });
    expect(artworkWidthPt(TIGHT, (await paint(placed))!.widthPt)).toBeCloseTo(widthPt * 2, 1);
  });

  it('keeps or drops the buried layers as the page says', async () => {
    const kept = (await paint())!.svg.match(/<polygon /g)!.length;
    const dropped = (await paint(figure(), { ...TIGHT, keepHiddenFaces: false }))!.svg.match(
      /<polygon /g
    )!.length;
    const visible = new Set(kernel.subfaces.map((subface) => subface.faces_top_to_bottom[0])).size;
    expect(kept).toBe(kernel.faces.length);
    expect(dropped).toBe(visible);
    expect(dropped).toBeLessThan(kept);
  });

  it('has nothing to paint for a scene with nothing in it', async () => {
    const empty: OristudioCpFoldedPaperScene = { ...kernel, faces: [], subfaces: [], aux_lines: [] };
    // Not the kernel's picture, then, and this figure stores none of its own.
    expect(
      foldedFigureExportPicture(figure(), { model: null, aux: null, kernel: empty, cssPerUserUnit: 1 })
    ).toBeNull();
    const exported = target(figure(), { kind: 'flat', kernel: empty, cssPerUserUnit: 1 });
    await expect(
      exported.buildScene(
        paperExportSceneInput(exported, DEFAULT_PAPER_STYLE, { ...TIGHT, format: 'svg' })
      )
    ).resolves.toBeNull();
  });
});

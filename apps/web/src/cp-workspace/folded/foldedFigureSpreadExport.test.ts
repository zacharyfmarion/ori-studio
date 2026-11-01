/**
 * A spread Edit figure's own Export… draws its spread as the canvas does: in
 * the canvas's frame — the paper map, the figure's turn about its pivot — at
 * the figure's size on the canvas; a Default spread settled once, its hidden
 * anchor rings left out, and a bitmap for one too complex to clip, drawn in
 * the page's pens and size; unspread when it cannot be spread. Every other
 * figure exports as it did.
 */
import type { Point3, SpreadSolution } from '@oristudio/layer-spread';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_FOLDED_PLACEMENT,
  type OristudioCpFoldedFigureEntry,
  type OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import type { ConnectedPaperScene, PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { DEFAULT_PAPER_STYLE_SETTINGS, exportPaperStyle } from '../../lib/paperStyleSettings';
import type { PaperSceneInput } from '../../paperExport/paperExportTarget';

const workers = vi.hoisted(() => ({
  prepared: null as unknown,
  capture: vi.fn(),
  raster: vi.fn(),
}));
vi.mock('../../layer-spread/prepareConnected', () => ({
  prepareConnected: () => ({ promise: Promise.resolve(workers.prepared), release: () => {} }),
}));
vi.mock('../../layer-spread/captureConnected', () => ({ captureConnected: (scene: unknown) => workers.capture(scene) }));
vi.mock('../../layer-spread/rasterConnected', () => ({
  rasterConnected: (...args: unknown[]) => workers.raster(...args),
}));

const { connectedPaperScene } = await import('../../layer-spread/connectedScene');
const { foldedFigurePivot } = await import('../adapters/cpFoldedToScene');
const { connectedSpreadSource } = await import('./connectedSpreadSource');
const { foldedFigureExportPicture, foldedFigureExportTarget } = await import('./foldedFigureExportTarget');
const { foldedFigureSpreadFrame } = await import('./foldedFigureSpreadFrame');
const { foldedFlatPaperScene } = await import('./foldedFlatScene');
const { plainBook } = await import('./foldedPrecrease.fixtures');
const { DEFAULT_CONNECTED_SPREAD } = await import('./layerSpreadSettings');

type Entry = OristudioCpFoldedFigureEntry;
type LayerSpreadOptions = import('./foldedLayerSpread').LayerSpreadOptions;
const DEPTH = { kind: 'depth', amount: 0.05, toward: 'down' } as const;

/** A solve by hand for the book: the folded-over leaf lifts toward its free edge. */
function solved(kernel: OristudioCpFoldedPaperScene): PreparedConnectedSpread {
  const source = connectedSpreadSource(kernel);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const solution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => (id === 2 || id === 5 ? 0.2 : 0)),
    references: [reference, reference],
    diagnostics: {},
  } as unknown as SpreadSolution;
  return { source, solution };
}

/** A flat figure as the fold leaves it, its spread set as given. */
function figure(spread: Entry['spread'], overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'flat-1',
    title: 'Folded model 1',
    handle: 9,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: { display_style: 'Paper5', discovered_fold_cases: 1, outcome: 'Solved' } as unknown as NonNullable<
      Entry['snapshot']
    >,
    folded3d: null,
    renderSnapshot: null,
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: null,
    frameRadius: null,
    error: null,
    spread,
    ...overrides,
  } as Entry;
}

/** A spread this build reads, as a figure holds it. */
const record = (spread: LayerSpreadOptions): Entry['spread'] => ({ kind: 'record', spread });

function pictureOf(entry: Entry, kernel: OristudioCpFoldedPaperScene | null, cssPerUserUnit = 1) {
  return foldedFigureExportPicture(entry, { model: null, aux: null, kernel, cssPerUserUnit });
}

function targetOf(entry: Entry, kernel: OristudioCpFoldedPaperScene | null, cssPerUserUnit = 1) {
  const picture = pictureOf(entry, kernel, cssPerUserUnit);
  if (!picture) throw new Error('a picture');
  return foldedFigureExportTarget({
    figure: entry,
    picture,
    title: 'Export',
    fileStem: 'Crane',
    exportStyle: exportPaperStyle(DEFAULT_PAPER_STYLE_SETTINGS, undefined),
    storedSceneHint: '',
  });
}

const input = (mm = 50): PaperSceneInput => ({
  page: 0,
  style: DEFAULT_PAPER_STYLE,
  markHidden: false,
  background: null,
  sheet: { mm },
});

/** The canvas's own picture of a figure's spread, as `useFoldedFlatSpread` builds it. */
function canvasPicture(entry: Entry, kernel: OristudioCpFoldedPaperScene, spread: typeof DEPTH) {
  const frame = foldedFigureSpreadFrame(foldedFigurePivot(entry), entry.placement.rotation);
  return foldedFlatPaperScene(kernel, { markHidden: false, spread, toScenePx: frame.toScenePx, scale: frame.scale });
}

beforeEach(() => {
  workers.prepared = solved(plainBook());
  workers.capture.mockReset();
  workers.raster.mockReset();
});

describe('which figures export their spread', () => {
  it('a live flat figure whose spread is on, from the scene the export reads', () => {
    const kernel = plainBook();
    expect(pictureOf(figure(record(DEPTH)), kernel)).toMatchObject({
      kind: 'spread',
      kernel,
      spread: DEPTH,
    });
  });

  it('a figure reopened with no fold, from the scene its file carried', () => {
    const carried = plainBook();
    const reopened = figure(record(DEPTH), { handle: null, spreadScene: carried });
    expect(pictureOf(reopened, null)).toMatchObject({ kind: 'spread', kernel: carried });
  });

  it('not a figure with its spread off, nor one in a look that draws no spread', () => {
    const kernel = plainBook();
    expect(pictureOf(figure(null), kernel)?.kind).toBe('flat');
    expect(pictureOf(figure(record(DEPTH), { displayStyle: 'Wire2' }), kernel)?.kind).not.toBe(
      'spread'
    );
    expect(pictureOf(figure({ kind: 'newer', saved: {} }), kernel)?.kind).toBe('flat');
  });
});

describe('a spread figure’s export', () => {
  it('is the canvas’s picture of it, at the figure’s size on the canvas', async () => {
    const kernel = plainBook();
    const entry = figure(record(DEPTH));
    const scene = await targetOf(entry, kernel).buildScene(input());
    expect(scene).toEqual(canvasPicture(entry, kernel, DEPTH));

    // Twice the size on the canvas: the same picture, twice as large.
    const twice = await targetOf(entry, kernel, 2).buildScene(input());
    expect(twice!.bounds.maxX - twice!.bounds.minX).toBeCloseTo(2 * (scene!.bounds.maxX - scene!.bounds.minX), 6);
  });

  it('is turned as the figure is, its layers stepped the way the page shows them', async () => {
    const kernel = plainBook();
    const turned = figure(record(DEPTH), {
      placement: { ...IDENTITY_FOLDED_PLACEMENT, rotation: Math.PI / 2 },
    });
    const scene = await targetOf(turned, kernel).buildScene(input());
    expect(scene).toEqual(canvasPicture(turned, kernel, DEPTH));
  });

  it('keeps no buried face, so no option can write one twice', () => {
    const target = targetOf(figure(record(DEPTH)), plainBook());
    expect(target.buriesFaces).toBe(false);
  });

  it('settles a Default spread once, leaving its hidden anchor rings out', async () => {
    workers.capture.mockImplementation(async (live: ConnectedPaperScene) =>
      connectedPaperScene(live.connected, live.sheet, true)
    );
    const target = targetOf(figure(record(DEFAULT_CONNECTED_SPREAD)), plainBook());
    const scene = await target.buildScene(input());
    expect(scene!.items.length).toBeGreaterThan(0);
    expect(scene!.items.some((item) => item.kind === 'face' && item.hidden)).toBe(false);
    // Another page size draws the same scene: no new capture.
    await target.buildScene(input(80));
    expect(workers.capture).toHaveBeenCalledTimes(1);
  });

  it('draws a Default spread too complex to clip as a bitmap, at the page’s size, in the page’s pens', async () => {
    workers.capture.mockImplementation(async (live: unknown) => live);
    workers.raster.mockImplementation(async () => ({
      png: new ArrayBuffer(4),
      width: 40,
      height: 20,
      scale: 1,
      sceneFrame: [-1, -1, 12, 7],
    }));
    const target = targetOf(figure(record(DEFAULT_CONNECTED_SPREAD)), plainBook());
    const scene = await target.buildScene(input(50));
    expect(scene!.items).toHaveLength(1);
    expect(scene!.items[0]).toMatchObject({ kind: 'markup', svg: expect.stringContaining('<image') });
    expect(workers.raster.mock.calls[0]!.slice(2)).toEqual([50, expect.anything(), 'folded-flat']);
    // Another size draws the bitmap again from the scene it kept: no new capture.
    await target.buildScene(input(120));
    expect(workers.capture).toHaveBeenCalledTimes(1);
    expect(workers.raster).toHaveBeenCalledTimes(2);
    expect(workers.raster.mock.calls[1]![2]).toBe(120);
  });

  it('draws the figure unspread when its spread cannot be made', async () => {
    workers.capture.mockRejectedValue(new Error('Spread capture worker failed'));
    const kernel = plainBook();
    const entry = figure(record(DEFAULT_CONNECTED_SPREAD));
    const scene = await targetOf(entry, kernel).buildScene(input());
    const frame = foldedFigureSpreadFrame(foldedFigurePivot(entry), entry.placement.rotation);
    expect(scene).toEqual(
      foldedFlatPaperScene(kernel, { markHidden: false, toScenePx: frame.toScenePx, scale: frame.scale })
    );
  });
});

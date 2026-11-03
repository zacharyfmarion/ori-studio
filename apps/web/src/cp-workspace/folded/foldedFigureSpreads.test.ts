import { describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedFigureEntry, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { foldedFigureRefoldKey } from './foldedFigureLayerOrders';
import type { FoldedFigureSpread } from './foldedFigureSpread';
import type { LayerSpreadOptions } from './foldedLayerSpread';
import {
  FOLDED_FIGURE_SPREAD_SCENE_BUDGET_BYTES,
  FOLDED_FIGURE_SPREADS_KEY as KEY,
  figureIdsInFoldedFigureSpreads,
  foldedFiguresWithLiveSpreadScenes,
  foldedFigureSpreadFigureKey,
  foldedFigureSpreadsAfterSave,
  linkFoldedFigureSpreads,
  readFoldedFigureSpreadScene,
  withFoldedFigureSpreads,
} from './foldedFigureSpreads';
import { DEFAULT_AFFINE_SPREAD, DEFAULT_CONNECTED_SPREAD, DEFAULT_DEPTH_SPREAD } from './layerSpreadSettings';

/** A flat figure, solved, as a reopened file holds it (no handle) unless `handle`. */
function figure(
  id: string,
  { fingerprint = 'cs1:fold', foldCase = 1, handle = null as number | null, state = 'Front0' as const } = {}
): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: `Title ${id}`,
    handle,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: {
      model: { ...DEFAULT_FOLDED_MODEL, state },
      estimation_step: 'Step5',
      display_style: 'Paper5',
      discovered_fold_cases: foldCase,
      current_fold_case: foldCase,
      find_another_overlap_valid: false,
      text_result: '',
      wireframe: null,
      outcome: 'Solved',
    },
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    sourceBounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
    sourceFingerprint: fingerprint,
    error: null,
  };
}

/** A small paper scene of the kernel's shape: one square face, one subface. */
function scene(sheet = 1): OristudioCpFoldedPaperScene {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  return {
    schema_version: 3,
    flipped: false,
    sheet,
    faces: [
      {
        outline: square,
        points: [0, 1, 2, 3],
        front_up: true,
        edges: square.map((from, index) => ({ from, to: square[(index + 1) % 4]!, kind: 'border' as const })),
      },
    ],
    subfaces: [{ polygon: square, faces_top_to_bottom: [0] }],
    aux_lines: [],
    sheet_points: square,
  };
}

const record = (spread: LayerSpreadOptions = DEFAULT_CONNECTED_SPREAD): FoldedFigureSpread => ({ kind: 'record', spread });

function spread(entry: OristudioCpFoldedFigureEntry, value = record(), withScene = true): OristudioCpFoldedFigureEntry {
  return { ...entry, spread: value, ...(withScene ? { spreadScene: scene() } : {}) };
}

/** What the writer puts in the bag, read back the way a file is. */
function saved(extensions: Record<string, unknown>, figures: OristudioCpFoldedFigureEntry[]) {
  return JSON.parse(JSON.stringify(withFoldedFigureSpreads(extensions, figures))) as Record<string, unknown>;
}

/** The figures as a file hands them to the reader: no spread on any. */
function bare(figures: OristudioCpFoldedFigureEntry[]): OristudioCpFoldedFigureEntry[] {
  return figures.map(({ spread: _spread, spreadScene: _scene, ...entry }) => entry);
}

describe('zero bytes by default', () => {
  it('returns the very bag when no figure has a spread and the bag has no key', () => {
    const extensions = { other: { a: 1 } };
    expect(withFoldedFigureSpreads(extensions, [figure('generated-1'), { ...figure('generated-2'), spread: null }])).toBe(
      extensions
    );
  });

  it('leaves the key out once the last spread is turned off', () => {
    const first = saved({ other: 1 }, [spread(figure('generated-1'))]);
    const linked = linkFoldedFigureSpreads(first, bare([figure('generated-1')]));
    const off = linked.figures.map((entry) => ({ ...entry, spread: null }));
    expect(Object.keys(withFoldedFigureSpreads(linked.extensions, off))).toEqual(['other']);
  });
});

describe('a spread and its scene', () => {
  it.each([
    ['Default', DEFAULT_CONNECTED_SPREAD],
    ['Affine', DEFAULT_AFFINE_SPREAD],
    ['Depth', DEFAULT_DEPTH_SPREAD],
  ] as const)('saves a %s spread under its figure’s id, and attaches it back with its scene', (_name, value) => {
    const entry = spread(figure('generated-1'), record(value));
    const bag = saved({}, [entry, figure('generated-2')]);
    const written = (bag[KEY] as { figures: Record<string, Record<string, unknown>> }).figures;
    expect(Object.keys(written)).toEqual(['generated-1']);
    expect(written['generated-1']).toEqual({
      figureKey: foldedFigureSpreadFigureKey(entry),
      refoldKey: foldedFigureRefoldKey(entry),
      spread: JSON.parse(JSON.stringify(value)),
      scene: JSON.stringify(scene()),
    });

    const linked = linkFoldedFigureSpreads(bag, bare([entry, figure('generated-2')]));
    expect(linked.figures[0]!.spread).toEqual(record(value));
    expect(linked.figures[0]!.spreadScene).toEqual(scene());
    expect(linked.figures[1]).not.toHaveProperty('spread');
    // The figures hold their own entries; the key stays where it was, holding the rest.
    expect(linked.extensions).toEqual({ [KEY]: {} });
    // Saved again, the same bag.
    expect(saved(linked.extensions, linked.figures)).toEqual(bag);
  });

  it('writes a scene read back as the very string it came as', () => {
    const json = JSON.stringify(scene(2));
    const read = readFoldedFigureSpreadScene(json)!;
    const bag = saved({}, [{ ...figure('generated-1'), spread: record(), spreadScene: read }]);
    expect((bag[KEY] as { figures: Record<string, { scene: string }> }).figures['generated-1']!.scene).toBe(json);
  });

  it('leaves out a scene past the budget, and keeps the spread', () => {
    // About 20 bytes a point: a scene a little past the budget.
    const points = Math.ceil(FOLDED_FIGURE_SPREAD_SCENE_BUDGET_BYTES / 18);
    const big = { ...scene(), sheet_points: Array.from({ length: points }, (_, x) => ({ x, y: 0.5 })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(FOLDED_FIGURE_SPREAD_SCENE_BUDGET_BYTES);
    const bag = saved({}, [{ ...figure('generated-1'), spread: record(), spreadScene: big }]);
    const written = (bag[KEY] as { figures: Record<string, Record<string, unknown>> }).figures['generated-1']!;
    expect(written).not.toHaveProperty('scene');
    expect(written.spread).toEqual(JSON.parse(JSON.stringify(DEFAULT_CONNECTED_SPREAD)));
    const linked = linkFoldedFigureSpreads(bag, bare([figure('generated-1')]));
    expect(linked.figures[0]!.spread).toEqual(record());
    expect(linked.figures[0]).not.toHaveProperty('spreadScene');
  });

  it('drops a damaged scene and keeps the spread', () => {
    const bag = saved({}, [spread(figure('generated-1'))]);
    const entries = (bag[KEY] as { figures: Record<string, Record<string, unknown>> }).figures;
    entries['generated-1']!.scene = '{"schema_version":3,"faces":';
    const linked = linkFoldedFigureSpreads(bag, bare([figure('generated-1')]));
    expect(linked.figures[0]!.spread).toEqual(record());
    expect(linked.figures[0]).not.toHaveProperty('spreadScene');
    expect(readFoldedFigureSpreadScene(JSON.stringify({ ...scene(), faces: [{ outline: [] }] }))).toBeNull();
    expect(readFoldedFigureSpreadScene(42)).toBeNull();
  });
});

describe('a newer build’s spread', () => {
  it('is held as it came, a new kind or a new field alike, and written back unchanged', () => {
    const entry = figure('generated-1');
    const keys = { figureKey: foldedFigureSpreadFigureKey(entry), refoldKey: foldedFigureRefoldKey(entry) };
    const newerKind = { ...keys, spread: { kind: 'radial', amount: 0.4 }, scene: JSON.stringify(scene()) };
    const newerField = { ...keys, spread: { kind: 'depth', amount: 0.025, toward: 'down' }, pinned: true };
    const bag = { [KEY]: { figures: { 'generated-1': newerKind, 'generated-2': newerField } } };
    const linked = linkFoldedFigureSpreads(bag, [entry, { ...figure('generated-2') }]);
    expect(linked.figures[0]!.spread).toEqual({ kind: 'newer', saved: newerKind });
    // A newer build's spread is that build's to draw: its scene stays in its entry.
    expect(linked.figures[0]).not.toHaveProperty('spreadScene');
    expect(linked.figures[1]!.spread).toEqual({ kind: 'newer', saved: newerField });
    expect(JSON.stringify(withFoldedFigureSpreads(linked.extensions, linked.figures))).toBe(JSON.stringify(bag));
  });
});

describe('damage', () => {
  it('drops an entry that is not one, or whose spread does not read', () => {
    const entry = figure('generated-1');
    const keys = { figureKey: foldedFigureSpreadFigureKey(entry), refoldKey: foldedFigureRefoldKey(entry) };
    const bag = {
      [KEY]: {
        figures: {
          'generated-1': { ...keys, spread: { kind: 'depth', amount: 'lots', toward: 'down' } },
          'generated-2': 'spread',
          'generated-3': { refoldKey: keys.refoldKey, spread: DEFAULT_CONNECTED_SPREAD },
          'generated-4': { ...keys },
        },
      },
    };
    const figures = ['generated-1', 'generated-2', 'generated-3', 'generated-4'].map((id) => figure(id));
    const linked = linkFoldedFigureSpreads(bag, figures);
    expect(linked.figures.every((each) => each.spread === undefined)).toBe(true);
    expect(withFoldedFigureSpreads(linked.extensions, linked.figures)).toEqual({});
  });
});

describe('through an older build', () => {
  const entry = spread(figure('generated-1'));
  const bag = () => saved({}, [entry]);

  it('keeps the spread of a figure that build refolded after an edit, but not its scene', () => {
    const refolded = { ...figure('generated-1'), sourceFingerprint: 'cs1:edited' };
    const linked = linkFoldedFigureSpreads(bag(), [refolded]);
    expect(linked.figures[0]!.spread).toEqual(record());
    expect(linked.figures[0]).not.toHaveProperty('spreadScene');
  });

  it('drops the scene of a figure that build turned over, or stepped to another solution', () => {
    for (const changed of [figure('generated-1', { state: 'Back1' as never }), figure('generated-1', { foldCase: 2 })]) {
      const linked = linkFoldedFigureSpreads(bag(), [changed]);
      expect(linked.figures[0]!.spread).toEqual(record());
      expect(linked.figures[0]).not.toHaveProperty('spreadScene');
    }
  });

  it('keeps the spread and the scene of a figure that build moved or renamed', () => {
    const moved = { ...figure('generated-1'), title: 'Renamed', placement: { offset: { x: 40, y: 0 }, scale: 2, rotation: 0 } };
    const linked = linkFoldedFigureSpreads(bag(), [moved]);
    expect(linked.figures[0]!.spread).toEqual(record());
    expect(linked.figures[0]!.spreadScene).toEqual(scene());
  });

  it('gives nothing to a new figure on the reused id, and writes the entry back as it came', () => {
    const reused = { ...figure('generated-1', { fingerprint: 'cs1:other' }), title: 'Folded model 2' };
    const linked = linkFoldedFigureSpreads(bag(), [reused]);
    expect(linked.figures[0]).not.toHaveProperty('spread');
    expect(withFoldedFigureSpreads(linked.extensions, linked.figures)).toEqual(bag());
    expect(figureIdsInFoldedFigureSpreads(bag())).toEqual(['generated-1']);
  });

  it('carries an entry whose figure that build deleted, as it came', () => {
    const linked = linkFoldedFigureSpreads(bag(), []);
    expect(withFoldedFigureSpreads(linked.extensions, [])).toEqual(bag());
  });
});

describe('after a save', () => {
  it('holds only what no figure holds, so a spread the save dropped stays dropped', () => {
    const own = spread(figure('generated-1'));
    const carried = saved({}, [spread(figure('generated-9'))]);
    const session = foldedFigureSpreadsAfterSave(carried, [own]);
    expect(Object.keys((session[KEY] as { figures: object }).figures)).toEqual(['generated-9']);
    // Turned off after the save, the next save writes the carried one alone.
    const next = saved(session, [{ ...own, spread: null }]);
    expect(Object.keys((next[KEY] as { figures: object }).figures)).toEqual(['generated-9']);
  });
});

describe('the scenes a save reads', () => {
  it('reads a live spread figure’s scene, keeps a reopened one’s, and saves on when a read fails', async () => {
    const live = spread(figure('generated-1', { handle: 4 }), record(), false);
    const reopened = spread(figure('generated-2'));
    const failing = spread(figure('generated-3', { handle: 5 }), record(), false);
    const unspread = figure('generated-4', { handle: 6 });
    const wireframe = { ...spread(figure('generated-5', { handle: 7 }), record(), false), displayStyle: 'Wire2' as const };
    const read = vi.fn(async (handle: number) => {
      if (handle === 5) throw new Error('freed');
      return scene(handle);
    });
    const failed = vi.fn();
    const figures = await foldedFiguresWithLiveSpreadScenes([live, reopened, failing, unspread, wireframe], read, failed);
    expect(read.mock.calls.map(([handle]) => handle)).toEqual([4, 5]);
    expect(figures[0]!.spreadScene).toEqual(scene(4));
    expect(figures[1]).toBe(reopened);
    expect(figures[2]).not.toHaveProperty('spreadScene');
    expect(figures[3]).toBe(unspread);
    expect(figures[4]).toBe(wireframe);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('saves no scene for a figure whose handle shows another layer order, as an undo leaves one', async () => {
    // Another solution, then Undo: the entry is back on solution 1, the handle on solution 2.
    const restored = spread(figure('generated-1', { handle: 4, foldCase: 1 }), record(), false);
    const shows = vi.fn(async () => figure('generated-1', { handle: 4, foldCase: 2 }).snapshot!);
    const read = vi.fn(async (handle: number) => scene(handle));
    const [kept] = await foldedFiguresWithLiveSpreadScenes([restored], read, undefined, shows);
    expect(kept).not.toHaveProperty('spreadScene');
    expect(read).not.toHaveBeenCalled();
    // On its own order again, the handle's scene is the figure's.
    shows.mockResolvedValue(restored.snapshot!);
    const [saved] = await foldedFiguresWithLiveSpreadScenes([restored], read, undefined, shows);
    expect(saved!.spreadScene).toEqual(scene(4));
  });
});

it('round trips the spatial recipe and carries an unknown version losslessly', () => {
  const spatial = { ...figure('spatial'), spread: { kind: 'spatial', version: 1, amount: 2 } as const };
  const bag = saved({}, [spatial]);
  expect(linkFoldedFigureSpreads(bag, bare([spatial])).figures[0]!.spread).toEqual(spatial.spread);
  const future = structuredClone(bag);
  const entries = (future[KEY] as { figures: Record<string, { spread: unknown }> }).figures;
  entries.spatial!.spread = { kind: 'spatial', version: 2, amount: 3, future: 'kept' };
  const reopened = linkFoldedFigureSpreads(future, bare([spatial]));
  expect(reopened.figures[0]!.spread?.kind).toBe('newer');
  expect(saved(reopened.extensions, reopened.figures)).toEqual(future);
});

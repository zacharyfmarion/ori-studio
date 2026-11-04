/**
 * The canvas's spread figures, end to end short of the GPU: the scene comes
 * from the handle's table, a Default spread waits on its own lease and draws
 * once its solve lands, a late solve never lands on a refolded figure, a
 * write of the figure's colours keeps its solve, a move redraws the picture
 * it has, X-ray is see-through, and the chrome measures the picture only once
 * no edit is mid gesture.
 */
import { act, useEffect, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Point3, SpreadSolution } from '@oristudio/layer-spread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { stackDepth, xrayFaceAlpha } from '../../layer-order/panes/layerPaneFigure';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE, effectivePaperStyle } from '../../lib/paper/paperStyle';
import type { FoldedFigureSpreadPicture } from '../adapters/cpFoldedToScene';
import { connectedSpreadSource } from './connectedSpreadSource';
import { foldedFigureGesture } from './foldedFigureGesture';
import { foldedFigureSpreadBlock } from './foldedFigureSpread';
import { foldedFigureSpreadReach, resetFoldedFigureSpreadReach } from './foldedFigureSpreadReach';
import { useFoldedFigureSpreadStatusStore } from './foldedFigureSpreadStatus';
import { resetFoldedFlatScenes, setFoldedFlatScene } from './foldedFlatScenes';
import { plainBook } from './foldedPrecrease.fixtures';
import { DEFAULT_CONNECTED_SPREAD } from './layerSpreadSettings';
import { useFoldedFlatSpread } from './useFoldedFlatSpread';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const leases = vi.hoisted(() => ({
  taken: [] as Array<{
    scene: unknown;
    priority: number;
    released: boolean;
    resolve: (prepared: unknown) => void;
    reject: (error: unknown) => void;
  }>,
}));
vi.mock('../../layer-spread/prepareConnected', () => ({
  prepareConnected: (scene: unknown, _yUp: boolean, priority: number) => {
    let resolve!: (prepared: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const lease = { scene, priority, released: false, resolve, reject };
    leases.taken.push(lease);
    return {
      promise,
      release: () => {
        lease.released = true;
        reject(new DOMException('released', 'AbortError'));
      },
    };
  },
}));

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

const HANDLE = 7;
const snapshotOf = (): OristudioCpFoldedFigureSnapshot =>
  ({
    model: DEFAULT_FOLDED_MODEL,
    outcome: 'Solved',
    display_style: 'Paper5',
    discovered_fold_cases: 1,
  }) as OristudioCpFoldedFigureSnapshot;
/** The display style with the figure's own pins on top, as the canvas inks a figure. */
const styleOf = (entry: OristudioCpFoldedFigureEntry) => effectivePaperStyle(DEFAULT_PAPER_STYLE, entry.appearance);

function figure(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  return {
    id: 'f1',
    title: 'f1',
    handle: HANDLE,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: SNAPSHOT,
    renderSnapshot: {
      schema_version: 1,
      fixture: null,
      pass: null,
      primitives: [
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: {
            paint: { kind: 'color', color: { red: 1, green: 1, blue: 1, alpha: 255 } },
            stroke: { kind: 'none' },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
          },
        },
      ],
    },
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    spread: { kind: 'record', spread: DEFAULT_CONNECTED_SPREAD },
    ...overrides,
  } as OristudioCpFoldedFigureEntry;
}

let SNAPSHOT = snapshotOf();
let KERNEL = plainBook();
let root: Root | null = null;
let reader: ((figure: OristudioCpFoldedFigureEntry) => FoldedFigureSpreadPicture | null) | null = null;
/** The first figure's picture as the canvas reads it: in its render, before that commit's effects. */
let drawn: FoldedFigureSpreadPicture | null = null;

function Probe({ figures }: { figures: readonly OristudioCpFoldedFigureEntry[] }): null {
  const read = useFoldedFlatSpread(figures, styleOf);
  const inRender = useMemo(() => (figures[0] ? read(figures[0]) : null), [read, figures]);
  useEffect(() => {
    reader = read;
    drawn = inRender;
  });
  return null;
}

function mount(figures: readonly OristudioCpFoldedFigureEntry[]): void {
  act(() => {
    if (!root) root = createRoot(document.createElement('div'));
    root.render(<Probe figures={figures} />);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const status = (id = 'f1') => useFoldedFigureSpreadStatusStore.getState().byFigure[id] ?? null;
const picture = (entry: OristudioCpFoldedFigureEntry) => reader!(entry);

beforeEach(() => {
  leases.taken.length = 0;
  SNAPSHOT = snapshotOf();
  KERNEL = plainBook();
  setFoldedFlatScene(HANDLE, SNAPSHOT, KERNEL);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  reader = null;
  drawn = null;
  foldedFigureGesture.abortAll();
  resetFoldedFlatScenes();
  resetFoldedFigureSpreadReach();
});

describe('useFoldedFlatSpread', () => {
  it('draws the snapshot until its solve lands, then the spread, and says where it stands', async () => {
    const entry = figure();
    mount([entry]);
    expect(leases.taken).toHaveLength(1);
    expect(leases.taken[0]!.scene).toBe(KERNEL);
    expect(picture(entry)).toBeNull();
    expect(status()).toBe('preparing');

    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    const drawn = picture(entry);
    expect(drawn?.kind).toBe('connected');
    expect(status()).toBe('ready');
    // The chrome takes it in, measured on this fold.
    expect(foldedFigureSpreadReach(entry)).toMatchObject({ snapshot: SNAPSHOT });
  });

  it('redraws a moved or resized figure from the very geometry it had; a turn builds it again without solving', async () => {
    const entry = figure();
    mount([entry]);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    const first = picture(entry);
    const moved = (placement: Partial<FoldedFigurePlacement>) =>
      picture({ ...entry, placement: { ...entry.placement, ...placement } });
    expect(moved({ offset: { x: 50, y: -20 }, scale: 3 })).toMatchObject({ geometry: (first as { geometry: unknown }).geometry });
    const turned = moved({ rotation: 0.5 });
    expect(turned?.kind).toBe('connected');
    expect((turned as { geometry: unknown }).geometry).not.toBe((first as { geometry: unknown }).geometry);
    expect(leases.taken).toHaveLength(1);
  });

  it('never lands a late solve on a refolded figure', async () => {
    mount([figure()]);
    const before = KERNEL;
    // Refolded: a new fold on a new handle, and its scene.
    const refolded = snapshotOf();
    const after = plainBook();
    act(() => setFoldedFlatScene(HANDLE + 1, refolded, after));
    const entry = figure({ handle: HANDLE + 1, snapshot: refolded });
    mount([entry]);
    expect(leases.taken).toHaveLength(2);
    expect(leases.taken[0]!.released).toBe(true);
    leases.taken[0]!.resolve(solved(before));
    await settle();
    expect(picture(entry)).toBeNull();
    expect(status()).toBe('preparing');
    leases.taken[1]!.resolve(solved(after));
    await settle();
    expect(picture(entry)?.kind).toBe('connected');
  });

  it('keeps drawing spread when the crease pattern’s aux lines change, with no new solve', async () => {
    const entry = figure();
    mount([entry]);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    expect(drawn?.kind).toBe('connected');
    // An import that brings aux lines, or one drawn: the same fold's scene,
    // fetched again with the new lines, lands while the canvas renders.
    act(() => setFoldedFlatScene(HANDLE, SNAPSHOT, plainBook()));
    await settle();
    expect(drawn?.kind).toBe('connected');
    expect(leases.taken).toHaveLength(1);
    expect(status()).toBe('ready');
  });

  it('keeps drawing spread through a write of the figure’s colours, repainted from the solve it has', async () => {
    mount([figure()]);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    const geometryOf = () => (drawn as Extract<FoldedFigureSpreadPicture, { kind: 'connected' }> | null)?.geometry;
    const flat = geometryOf();
    // A colour dragged in the Style menu: a run of model writes in one gesture.
    let token: ReturnType<typeof foldedFigureGesture.begin> = null;
    act(() => {
      token = foldedFigureGesture.begin('scope:paper-front');
    });
    // The pin repaints the picture at once.
    mount([figure({ appearance: { 'paper.front': '#ff0000' } })]);
    expect(drawn?.kind).toBe('connected');
    const repainted = geometryOf();
    expect(repainted).not.toBe(flat);
    // The paper-style mirror writes the colour, and the kernel answers with a
    // new snapshot of the same fold: the same picture, and its box with it.
    const written = figure({
      appearance: { 'paper.front': '#ff0000' },
      snapshot: { ...SNAPSHOT, model: { ...SNAPSHOT.model, front_color: { red: 255, green: 0, blue: 0 } } },
    });
    mount([written]);
    expect(drawn?.kind).toBe('connected');
    expect(geometryOf()).toBe(repainted);
    expect(foldedFigureSpreadReach(written)).not.toBeNull();
    // The scene fetched again for the new snapshot lands.
    act(() => setFoldedFlatScene(HANDLE, written.snapshot!, plainBook()));
    await settle();
    expect(drawn?.kind).toBe('connected');
    act(() => foldedFigureGesture.abort(token!));
    expect(leases.taken).toHaveLength(1);
    expect(leases.taken[0]!.released).toBe(false);
    expect(status()).toBe('ready');
  });

  it('solves again for another solution or a side flip on the same handle', async () => {
    mount([figure()]);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    const another = { ...SNAPSHOT, discovered_fold_cases: 2, current_fold_case: 2 };
    const second = figure({ snapshot: another });
    mount([second]);
    expect(drawn).toBeNull();
    expect(foldedFigureSpreadReach(second)).toBeNull();
    act(() => setFoldedFlatScene(HANDLE, another, plainBook()));
    expect(leases.taken).toHaveLength(2);
    expect(leases.taken[0]!.released).toBe(true);
    const flipped = { ...another, model: { ...another.model, state: 'Back1' as const } };
    mount([figure({ snapshot: flipped })]);
    act(() => setFoldedFlatScene(HANDLE, flipped, plainBook()));
    expect(leases.taken).toHaveLength(3);
    expect(leases.taken[1]!.released).toBe(true);
  });

  it('lets go when the spread is turned off, and reports nothing for it', async () => {
    mount([figure()]);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    const off = figure({ spread: null });
    mount([off]);
    expect(leases.taken[0]!.released).toBe(true);
    expect(picture(off)).toBeNull();
    expect(status()).toBeNull();
    expect(foldedFigureSpreadReach(off)).toBeNull();
  });

  it('draws X-ray see-through, at the Layer order dialog’s X-ray alpha', async () => {
    const entry = figure({ displayStyle: 'Transparent3' });
    mount([entry]);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    expect(picture(entry)).toMatchObject({
      kind: 'connected',
      xray: { faceAlpha: xrayFaceAlpha(stackDepth(KERNEL)) },
    });
    // Wireframe has no spread form: the snapshot, and nothing to report.
    const wire = figure({ displayStyle: 'Wire2' });
    mount([wire]);
    expect(picture(wire)).toBeNull();
    expect(status()).toBeNull();
  });

  it('draws Affine and Depth at once, with no solve', () => {
    const entry = figure({
      spread: { kind: 'record', spread: { kind: 'depth', amount: 0.05, toward: 'down' } },
    });
    mount([entry]);
    expect(leases.taken).toHaveLength(0);
    expect(picture(entry)?.kind).toBe('scene');
    expect(status()).toBe('ready');
  });

  it('lets go of a figure’s picture once the figure is gone or draws no spread', () => {
    const entry = figure({
      spread: { kind: 'record', spread: { kind: 'depth', amount: 0.05, toward: 'down' } },
    });
    const sceneOf = () => (drawn as Extract<FoldedFigureSpreadPicture, { kind: 'scene' }> | null)?.scene;
    mount([entry]);
    const first = sceneOf();
    expect(first).toBeDefined();
    // Deleted, then put back by an undo: built again, not handed a picture kept for it.
    mount([]);
    mount([entry]);
    const back = sceneOf();
    expect(back).toBeDefined();
    expect(back).not.toBe(first);
    // Its spread turned off, then on again.
    mount([figure({ spread: null })]);
    mount([entry]);
    expect(sceneOf()).toBeDefined();
    expect(sceneOf()).not.toBe(back);
  });

  it('draws a reopened figure from the scene its file carried, and flat with none', async () => {
    const reopened = figure({ handle: null, spreadScene: KERNEL });
    mount([reopened]);
    expect(leases.taken[0]!.scene).toBe(KERNEL);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    expect(picture(reopened)?.kind).toBe('connected');
    const bare = figure({ handle: null, spreadScene: null });
    mount([bare]);
    expect(picture(bare)).toBeNull();
    expect(status()).toBeNull();
  });

  it('draws flat whenever the Properties sheet gives a reason against the spread', () => {
    // The sheet says "Refold to show the spread" for a fold that failed, and
    // "no layer order" for one that found none: the canvas agrees.
    const failed = figure({ status: 'error', error: 'The fold failed' });
    const unordered = figure({
      snapshot: { outcome: 'Solved', display_style: 'Paper5', discovered_fold_cases: 0 } as OristudioCpFoldedFigureSnapshot,
    });
    for (const entry of [failed, unordered]) {
      expect(foldedFigureSpreadBlock(entry, null)).not.toBeNull();
      mount([entry]);
      expect(leases.taken).toHaveLength(0);
      expect(picture(entry)).toBeNull();
      expect(status()).toBeNull();
    }
  });

  it('keeps the chrome still while an edit is mid gesture, and measures it once the gesture ends', async () => {
    const entry = figure();
    mount([entry]);
    leases.taken[0]!.resolve(solved(KERNEL));
    await settle();
    const settledReach = foldedFigureSpreadReach(entry);
    let token: ReturnType<typeof foldedFigureGesture.begin> = null;
    act(() => {
      token = foldedFigureGesture.begin('pane:spread-amount');
    });
    expect(token).not.toBeNull();
    // The reveal pulls the lifted corners down the page: a larger Amount reaches further.
    const wider = figure({ spread: { kind: 'record', spread: { ...DEFAULT_CONNECTED_SPREAD, amount: 2 } } });
    mount([wider]);
    expect(foldedFigureSpreadReach(wider)).toEqual(settledReach);
    act(() => foldedFigureGesture.abort(token!));
    expect(foldedFigureSpreadReach(wider)!.halfHeight).toBeGreaterThan(settledReach!.halfHeight);
  });
});

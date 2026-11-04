/**
 * The Export and Share dialogs' spread figure, short of the workers: a Default
 * spread is prepared once per fold and captured once per committed setting;
 * the last settled picture stays up, dimmed, while the next is made; a colour
 * edit repaints a scene and draws a bitmap again, never solving or capturing
 * again; Affine and Depth are their picture at once; a spread that cannot be
 * solved or clipped stays on, drawn unspread, says so, and gives way to
 * another kind.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TFunction } from 'i18next';
import type { Point3, SpreadSolution } from '@oristudio/layer-spread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedPaperScene, OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import { connectedPaperScene, type ConnectedPaperScene, type PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { connectedSpreadSource } from '../folded/connectedSpreadSource';
import { plainBook } from '../folded/foldedPrecrease.fixtures';
import type { LayerSpreadOptions } from '../folded/foldedLayerSpread';
import { DEFAULT_CONNECTED_SPREAD } from '../folded/layerSpreadSettings';
import { useExportFoldedSpread, type ExportFoldedSpread, type ExportFoldedSpreadOptions } from './useExportFoldedSpread';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workers = vi.hoisted(() => ({
  leases: [] as Array<{ scene: unknown; released: boolean; resolve: (p: unknown) => void; reject: (e: unknown) => void }>,
  captures: [] as Array<{ scene: unknown; resolve: (scene: unknown) => void; reject: (e: unknown) => void }>,
  rasters: [] as Array<{ style: unknown; policy: unknown; resolve: (raster: unknown) => void }>,
}));
vi.mock('../../layer-spread/prepareConnected', () => ({
  prepareConnected: (scene: unknown) => {
    let resolve!: (p: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const lease = { scene, released: false, resolve, reject };
    workers.leases.push(lease);
    return {
      promise,
      release: () => {
        lease.released = true;
        reject(new DOMException('released', 'AbortError'));
      },
    };
  },
}));
vi.mock('../../layer-spread/captureConnected', () => ({
  captureConnected: (scene: unknown) =>
    new Promise((resolve, reject) => workers.captures.push({ scene, resolve, reject })),
}));
vi.mock('../../layer-spread/rasterConnected', () => ({
  rasterConnected: (_scene: unknown, style: unknown, _mm: unknown, _signal: unknown, policy: unknown) =>
    new Promise((resolve) => workers.rasters.push({ style, policy, resolve })),
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

const resolvedOf = (live: unknown) => {
  const scene = live as ConnectedPaperScene;
  return connectedPaperScene(scene.connected, scene.sheet, true);
};
const RASTER = { png: new ArrayBuffer(4), width: 4, height: 2, scale: 1, sceneFrame: [0, 0, 4, 2] };

let root: Root | null = null;
let shown: ExportFoldedSpread | null = null;
const setSetting = vi.fn();
const turnOff = { calls: () => setSetting.mock.calls.filter(([next]) => next === null).length };
const t = ((key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)) as unknown as TFunction;

function Probe(props: ExportFoldedSpreadOptions) {
  const spread = useExportFoldedSpread(props);
  useEffect(() => {
    shown = spread;
  });
  return null;
}

const kernel = plainBook();
/** The fold's drawing, as the preview holds it beside its scene. */
const DRAWING = { schema_version: 1, fixture: null, pass: null, primitives: [] } as unknown as OristudioCpFoldedRenderSnapshot;
const base = (setting: LayerSpreadOptions | null, style: PaperStyle = DEFAULT_PAPER_STYLE): ExportFoldedSpreadOptions => ({
  enabled: true,
  preview: { figure: DRAWING, scene: kernel, ordered: true },
  setting,
  setSetting,
  turnDeg: 0,
  style,
  figureHeight: 928,
  t,
});

async function render(props: ExportFoldedSpreadOptions) {
  await act(async () => root!.render(<Probe {...props} />));
}

async function settle(step: () => void) {
  await act(async () => {
    step();
    await Promise.resolve();
  });
}

beforeEach(() => {
  workers.leases.length = 0;
  workers.captures.length = 0;
  workers.rasters.length = 0;
  setSetting.mockClear();
  root = createRoot(document.createElement('div'));
  shown = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('a Default spread in an export', () => {
  it('is prepared once per fold, and captured once per setting committed', async () => {
    await render(base(DEFAULT_CONNECTED_SPREAD));
    expect(workers.leases).toHaveLength(1);
    expect(shown).toMatchObject({ picture: null, busy: true });
    await settle(() => workers.leases[0]!.resolve(solved(kernel)));
    expect(workers.captures).toHaveLength(1);
    await settle(() => workers.captures[0]!.resolve(resolvedOf(workers.captures[0]!.scene)));
    const first = shown!.picture;
    expect(first).toMatchObject({ kind: 'scene', spread: 'connected' });
    expect(shown!.busy).toBe(false);

    // A new amount, committed: one capture, the same solve; the last picture stays meanwhile.
    await render(base({ ...DEFAULT_CONNECTED_SPREAD, amount: 1 }));
    expect(workers.leases).toHaveLength(1);
    expect(workers.captures).toHaveLength(2);
    expect(shown).toMatchObject({ picture: first, busy: true });
    await settle(() => workers.captures[1]!.resolve(resolvedOf(workers.captures[1]!.scene)));
    expect(shown!.picture).not.toBe(first);
    expect(shown!.busy).toBe(false);
  });

  it('repaints a scene in new colours, solving and capturing nothing again', async () => {
    await render(base(DEFAULT_CONNECTED_SPREAD));
    await settle(() => workers.leases[0]!.resolve(solved(kernel)));
    await settle(() => workers.captures[0]!.resolve(resolvedOf(workers.captures[0]!.scene)));
    const picture = shown!.picture;
    await render(base(DEFAULT_CONNECTED_SPREAD, { ...DEFAULT_PAPER_STYLE, paper: { ...DEFAULT_PAPER_STYLE.paper, front: '#123456' } }));
    expect(workers.leases).toHaveLength(1);
    expect(workers.captures).toHaveLength(1);
    expect(workers.rasters).toHaveLength(0);
    expect(shown).toMatchObject({ picture, busy: false });
  });

  it('draws a figure too complex to clip as a bitmap in the flat figure’s pens, and again in new colours', async () => {
    await render(base(DEFAULT_CONNECTED_SPREAD));
    await settle(() => workers.leases[0]!.resolve(solved(kernel)));
    // Over the capture's budget: the scene comes back unresolved.
    await settle(() => workers.captures[0]!.resolve(workers.captures[0]!.scene));
    expect(workers.rasters).toHaveLength(1);
    expect(workers.rasters[0]!.policy).toBe('folded-flat');
    await settle(() => workers.rasters[0]!.resolve(RASTER));
    expect(shown!.picture).toMatchObject({ kind: 'raster', href: expect.stringMatching(/^data:image\/png;base64,/) });

    const recoloured = { ...DEFAULT_PAPER_STYLE, paper: { ...DEFAULT_PAPER_STYLE.paper, front: '#123456' } };
    await render(base(DEFAULT_CONNECTED_SPREAD, recoloured));
    expect(workers.captures).toHaveLength(1);
    expect(workers.rasters).toHaveLength(2);
    expect(workers.rasters[1]!.style).toBe(recoloured);
    expect(shown!.busy).toBe(true);
    await settle(() => workers.rasters[1]!.resolve(RASTER));
    expect(shown!.busy).toBe(false);
  });

  it('stays on, drawn unspread and saying so, when its layers cannot be solved; Affine spreads them', async () => {
    const reason = 'These layers couldn’t be spread';
    await render(base(DEFAULT_CONNECTED_SPREAD));
    await settle(() => workers.leases[0]!.reject(new Error('Spread resource limit exceeded: overlap regions')));
    expect(turnOff.calls()).toBe(0);
    expect(shown).toMatchObject({ picture: null, busy: false, failed: true });
    expect(shown!.rows.toggle).toMatchObject({ pressed: true, note: reason });
    expect(shown!.rows.spread).toMatchObject({ disabled: false, valuesHeld: reason });

    // Affine needs no solve: picked, it spreads them at once, and the note goes.
    await act(async () => shown!.rows.spread!.kinds.find((kind) => kind.value === 'affine')!.run());
    const affine = setSetting.mock.lastCall![0] as LayerSpreadOptions;
    expect(affine.kind).toBe('affine');
    await render(base(affine));
    expect(shown).toMatchObject({ picture: { kind: 'scene', spread: 'affine' }, busy: false, failed: false });
    expect(shown!.rows.toggle.note).toBeUndefined();

    // Default again tries the solve again.
    await render(base(DEFAULT_CONNECTED_SPREAD));
    expect(workers.leases).toHaveLength(2);
    expect(shown).toMatchObject({ busy: true, failed: false });
    await settle(() => workers.leases[1]!.reject(new Error('Spread resource limit exceeded: overlap regions')));
    expect(shown).toMatchObject({ picture: null, busy: false, failed: true });
  });

  it('stays on, drawn unspread, when its capture fails, until a turn captures it', async () => {
    await render(base(DEFAULT_CONNECTED_SPREAD));
    await settle(() => workers.leases[0]!.resolve(solved(kernel)));
    await settle(() => workers.captures[0]!.reject(new Error('The clip failed')));
    expect(shown).toMatchObject({ picture: null, busy: false, failed: true });
    expect(turnOff.calls()).toBe(0);
    // A turn captures again from the solve it has; once that lands, it is spread.
    await render({ ...base(DEFAULT_CONNECTED_SPREAD), turnDeg: 90 });
    expect(workers.leases).toHaveLength(1);
    expect(workers.captures).toHaveLength(2);
    await settle(() => workers.captures[1]!.resolve(resolvedOf(workers.captures[1]!.scene)));
    expect(shown).toMatchObject({ picture: { kind: 'scene', spread: 'connected' }, busy: false, failed: false });
  });

  it('lets its solve go with the fold, and prepares the next one', async () => {
    await render(base(DEFAULT_CONNECTED_SPREAD));
    const next = plainBook();
    await render({ ...base(DEFAULT_CONNECTED_SPREAD), preview: { figure: DRAWING, scene: next, ordered: true } });
    expect(workers.leases[0]!.released).toBe(true);
    expect(workers.leases[1]!.scene).toBe(next);
  });
});

describe('a figure that spreads at once, or not at all', () => {
  it('is Affine or Depth at once, with no solve', async () => {
    await render(base({ kind: 'depth', amount: 0.05, toward: 'down' }));
    expect(shown).toMatchObject({ picture: { kind: 'scene', spread: 'depth' }, busy: false });
    expect(workers.leases).toHaveLength(0);
  });

  it('draws unspread, keeping its setting, when the fold has no layer order', async () => {
    await render({ ...base(DEFAULT_CONNECTED_SPREAD), preview: { figure: DRAWING, scene: kernel, ordered: false } });
    expect(shown).toMatchObject({ picture: null, busy: false, spreadable: false, failed: false });
    // A fold that landed with no paper scene — its see-through development — has none either.
    await render({ ...base(DEFAULT_CONNECTED_SPREAD), preview: { figure: DRAWING, scene: null, ordered: false } });
    expect(shown).toMatchObject({ picture: null, spreadable: false });
    expect(turnOff.calls()).toBe(0);
    expect(workers.leases).toHaveLength(0);
  });

  it('says nothing for or against a spread while no fold has landed, keeping its setting on', async () => {
    await render({ ...base(DEFAULT_CONNECTED_SPREAD), preview: { figure: null, scene: null, ordered: null } });
    expect(shown).toMatchObject({ picture: null, busy: false, spreadable: null, failed: false });
    expect(shown!.rows.toggle).toMatchObject({ pressed: true, disabled: false });
    expect(shown!.rows.toggle.note).toBeUndefined();
    expect(workers.leases).toHaveLength(0);
  });

  it('draws nothing of a spread that is off', async () => {
    await render(base(null));
    expect(shown).toMatchObject({ picture: null, busy: false, spreadable: true });
  });
});

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import type { FoldedFigureAuxStrokes } from '../adapters/cpFoldedToScene';
import {
  releaseFoldedFigureHandle,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from './foldedFigureHandles';
import type { FoldedAuxSource } from './foldedAuxSource';
import { foldedFlatSceneCount, resetFoldedFlatScenes } from './foldedFlatScenes';
import { resetFoldedFlatAuxFetches, useFoldedFlatAux } from './useFoldedFlatAux';

/**
 * When the canvas asks the kernel for a flat figure's paper scene, and what
 * it hands the adapter once it has one.
 *
 * The fetch is the expensive half and the gate is the whole point: a figure
 * whose style hides aux creases costs nothing, and one that shows them costs
 * one fetch per kernel snapshot, however many times the canvas re-renders.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetches = vi.hoisted(() => ({
  calls: [] as number[],
  documents: [] as Array<number | null | undefined>,
  answer: null as unknown,
  failures: 0,
}));
vi.mock('../../store/workspaceStore/oristudioCpRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/oristudioCpRuntime')>()),
  getOristudioCpFoldedFigurePaperScene: async (handle: number, documentHandle?: number | null) => {
    fetches.calls.push(handle);
    fetches.documents.push(documentHandle);
    if (fetches.failures > 0) {
      fetches.failures -= 1;
      throw { code: 'worker_busy', message: 'the worker could not answer' };
    }
    return fetches.answer;
  },
}));
const reported = vi.hoisted(() => ({ errors: [] as Array<{ error: unknown; surface?: string }> }));
vi.mock('../../monitoring', () => ({
  reportError: (error: unknown, context: { surface?: string } = {}) => {
    reported.errors.push({ error, surface: context.surface });
  },
}));

const SCENE: OristudioCpFoldedPaperScene = {
  schema_version: 1,
  flipped: false,
  sheet: 100,
  faces: [
    {
      outline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      front_up: true,
      edges: [],
    },
  ],
  subfaces: [
    {
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      faces_top_to_bottom: [0],
    },
  ],
  aux_lines: [{ from: { x: 10, y: 50 }, to: { x: 90, y: 50 }, face: 0 }],
};

function snapshot(): OristudioCpFoldedFigureSnapshot {
  return { model: {} } as OristudioCpFoldedFigureSnapshot;
}

function figure(
  id: string,
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: id,
    handle: 7,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: snapshot(),
    renderSnapshot: { schema_version: 1, fixture: null, pass: null, primitives: [] },
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  } as OristudioCpFoldedFigureEntry;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let reader: ((figure: OristudioCpFoldedFigureEntry) => FoldedFigureAuxStrokes | null) | null =
  null;

function Probe({
  figures,
  source,
}: {
  figures: readonly OristudioCpFoldedFigureEntry[];
  source?: FoldedAuxSource;
}): null {
  const read = useFoldedFlatAux(figures, source);
  useEffect(() => {
    reader = read;
  });
  return null;
}

function mount(figures: readonly OristudioCpFoldedFigureEntry[], source?: FoldedAuxSource): void {
  act(() => {
    if (!root) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    }
    root.render(<Probe figures={figures} source={source} />);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function showAux(visible: boolean): void {
  act(() => {
    useSettingsStore.getState().setPaperStyleField('display', 'auxCreases.visible', visible);
  });
}

beforeEach(async () => {
  fetches.calls = [];
  fetches.documents = [];
  fetches.failures = 0;
  reported.errors = [];
  fetches.answer = SCENE;
  resetFoldedFlatAuxFetches();
  resetFoldedFlatScenes();
  await resetFoldedFigureHandles();
  retainFoldedFigureHandle(7);
  act(() => {
    useSettingsStore.getState().setPaperStyleFields('display', {
      'auxCreases.visible': DEFAULT_PAPER_STYLE.auxCreases.visible,
      'auxCreases.pen': DEFAULT_PAPER_STYLE.auxCreases.pen,
      erode: DEFAULT_PAPER_STYLE.erode,
    });
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  reader = null;
});

describe('useFoldedFlatAux', () => {
  it('fetches nothing while the style hides aux creases, and answers null', async () => {
    // The display style shows aux creases by default, so hidden is a pin here.
    showAux(false);
    mount([figure('a')]);
    await settle();
    expect(fetches.calls).toEqual([]);
    expect(reader!(figure('a'))).toBeNull();
  });

  it('fetches once the toggle is on, and hands the adapter the pen and pieces', async () => {
    const entry = figure('a');
    showAux(false);
    mount([entry]);
    showAux(true);
    await settle();
    expect(fetches.calls).toEqual([7]);
    const strokes = reader!(entry);
    expect(strokes).not.toBeNull();
    expect(strokes!.segments).toEqual([{ a: { x: 10, y: 50 }, b: { x: 90, y: 50 } }]);
    // The default aux pen: #9aa4ad at 0.5 pt.
    expect(strokes!.widthMul).toBe(0.5);
    expect(strokes!.color.map((c) => Math.round(c * 255))).toEqual([154, 164, 173, 255]);
  });

  it('honours a figure’s own pin over the display style', async () => {
    const entry = figure('a', { appearance: { 'auxCreases.visible': true, erode: 0.1 } });
    mount([entry]);
    await settle();
    expect(fetches.calls).toEqual([7]);
    // Eroded by 0.1 × 100 at each end on the outline… neither end is, here:
    // the line ends inside the face, so both stay.
    expect(reader!(entry)!.segments).toEqual([{ a: { x: 10, y: 50 }, b: { x: 90, y: 50 } }]);
    const hidden = figure('b', { appearance: { 'auxCreases.visible': false } });
    showAux(true);
    expect(reader!(hidden)).toBeNull();
  });

  it('draws every layer’s pieces under a style that shows every layer', async () => {
    // Two faces, B over A: under Paper5 A's line shows only where A is on
    // top; under Transparent3 the drawer shows A through B, and so does its
    // line. The same fetched scene serves both, cut per coverage.
    fetches.answer = {
      ...SCENE,
      faces: [SCENE.faces[0]!, SCENE.faces[0]!],
      subfaces: [
        {
          polygon: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 100 },
            { x: 0, y: 100 },
          ],
          faces_top_to_bottom: [0],
        },
        {
          polygon: [
            { x: 50, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 50, y: 100 },
          ],
          faces_top_to_bottom: [1, 0],
        },
      ],
    };
    const opaque = figure('a');
    // The same figure with its style moved: the kernel snapshot is unchanged.
    const seeThrough = { ...opaque, displayStyle: 'Transparent3' as const };
    mount([opaque]);
    showAux(true);
    await settle();
    expect(reader!(opaque)!.segments).toEqual([{ a: { x: 10, y: 50 }, b: { x: 50, y: 50 } }]);
    expect(reader!(seeThrough)!.segments).toEqual([{ a: { x: 10, y: 50 }, b: { x: 90, y: 50 } }]);
    expect(fetches.calls).toEqual([7]);
  });

  it('fetches once per kernel snapshot, not per render', async () => {
    const entry = figure('a');
    showAux(true);
    mount([entry]);
    await settle();
    mount([entry]);
    mount([{ ...entry, renderSnapshot: { ...entry.renderSnapshot! } }]);
    await settle();
    expect(fetches.calls).toEqual([7]);
    // A new snapshot — a refold — is a new scene.
    mount([{ ...entry, snapshot: snapshot() }]);
    await settle();
    expect(fetches.calls).toEqual([7, 7]);
  });

  it('asks nothing for a 3D figure or one without a handle', async () => {
    showAux(true);
    mount([
      figure('spatial', { folded3d: {} as never }),
      figure('reopened', { handle: null }),
      figure('folding', { snapshot: null }),
    ]);
    await settle();
    expect(fetches.calls).toEqual([]);
  });

  it('keeps nothing for a handle released while the kernel was answering', async () => {
    const entry = figure('a');
    showAux(true);
    mount([entry]);
    releaseFoldedFigureHandle(7);
    await settle();
    expect(fetches.calls).toEqual([7]);
    expect(foldedFlatSceneCount()).toBe(0);
    expect(reader!(entry)).toBeNull();
  });

  it('answers null for a kernel that has no scene', async () => {
    fetches.answer = null;
    const entry = figure('a');
    showAux(true);
    mount([entry]);
    await settle();
    expect(reader!(entry)).toBeNull();
  });

  // An aux line drawn on the crease pattern after the fold is on the paper,
  // not folded, so the figure asks for its scene again — from the document —
  // and draws the one it has until the new one lands.
  it('asks again when the document’s aux lines change, from the document', async () => {
    const entry = figure('a');
    showAux(true);
    mount([entry], { documentHandle: 4, auxKey: 'one' });
    await settle();
    expect(fetches.calls).toEqual([7]);
    expect(fetches.documents).toEqual([4]);
    mount([entry], { documentHandle: 4, auxKey: 'one' });
    await settle();
    expect(fetches.calls).toEqual([7]);

    const drawn = { ...SCENE, aux_lines: [{ from: { x: 50, y: 0 }, to: { x: 50, y: 100 }, face: 0 }] };
    fetches.answer = drawn;
    mount([entry], { documentHandle: 4, auxKey: 'two' });
    // A fetch behind, the scene it has still draws.
    expect(reader!(entry)!.segments).toEqual([{ a: { x: 10, y: 50 }, b: { x: 90, y: 50 } }]);
    await settle();
    expect(fetches.calls).toEqual([7, 7]);
    expect(reader!(entry)!.segments).toEqual([{ a: { x: 50, y: 0 }, b: { x: 50, y: 100 } }]);
  });

  it('asks again after a failed fetch, and reports one that keeps failing', async () => {
    vi.useFakeTimers();
    try {
      const entry = figure('a');
      showAux(true);
      fetches.failures = 1;
      mount([entry]);
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(fetches.calls).toEqual([7, 7]);
      expect(reader!(entry)).not.toBeNull();
      expect(reported.errors).toEqual([]);

      const next = { ...entry, snapshot: snapshot() };
      fetches.failures = 3;
      mount([next]);
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(fetches.calls).toHaveLength(5);
      expect(reported.errors).toHaveLength(1);
      expect(reported.errors[0]!.surface).toBe('folded-flat-aux');
    } finally {
      vi.useRealTimers();
    }
  });
});

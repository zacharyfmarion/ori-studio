import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';

/**
 * A folded figure's kernel handle across Delete, Refold and their undo, with
 * the kernel's figure arena stood in for: a fold takes the lowest free slot,
 * a free gives it back, and drawing a slot that is not live fails, as the
 * kernel's `flat(handle)` does.
 *
 * The verbs let go of the live list's reference inside the act, and the
 * folded layer's bracket records the entry that keeps the old fold only after
 * it; and an undo swaps the live list with an entry. Each handle has to keep
 * one holder through both, or an undo puts back a figure whose slot is gone —
 * or, once the next fold took the slot, another figure's.
 */
const arena = vi.hoisted(() => ({
  live: new Set<number>(),
  freed: [] as number[],
  take(): number {
    let slot = 0;
    while (this.live.has(slot)) slot += 1;
    this.live.add(slot);
    return slot;
  },
}));

vi.mock('./oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioCpRuntime')>();
  return {
    ...actual,
    freeOristudioCpFoldedFigure: async (handle: number) => {
      arena.freed.push(handle);
      arena.live.delete(handle);
    },
    foldOristudioCpDocument: async () => ({ handle: arena.take(), snapshot: snapshot() }),
    getOristudioCpFoldedFigureRenderSnapshot: async (handle: number) => {
      if (!arena.live.has(handle)) throw new Error(`no folded figure in slot ${handle}`);
      return renderSnapshot();
    },
    setOristudioCpFoldedFigureModel: async (handle: number, model: OristudioCpFoldedFigureSnapshot['model']) => {
      if (!arena.live.has(handle)) throw new Error(`no folded figure in slot ${handle}`);
      return { ...snapshot(), model };
    },
    isCurrentOristudioCpDocumentState: () => true,
  };
});

import { useWorkspaceStore } from './store';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import {
  foldedFigureHandleRefCount,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { foldedFigureGesture } from '../../cp-workspace/folded/foldedFigureGesture';
import { deleteFoldedFigure } from '../../cp-workspace/folded/foldedFigureVerbs';
import { foldedSourceBounds } from '../../cp-workspace/folded/foldedFigureStaleness';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function renderSnapshot(): OristudioCpFoldedRenderSnapshot {
  return { schema_version: 1, fixture: null, pass: 'paper-front-full', primitives: [] };
}

function snapshot(): OristudioCpFoldedFigureSnapshot {
  return {
    model: {
      front_color: { red: 255, green: 255, blue: 50 },
      back_color: { red: 233, green: 233, blue: 233 },
      line_color: { red: 0, green: 0, blue: 0 },
      scale: 1,
      rotation: 0,
      anti_alias: true,
      display_shadows: false,
      state: 'Front0',
      folded_cases: 1,
      transparent_transparency: 16,
      transparency_color: false,
    },
    estimation_step: 'Step5',
    display_style: 'Paper5',
    discovered_fold_cases: 1,
    find_another_overlap_valid: false,
    text_result: '',
    wireframe: {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      lines: [{ begin: 0, end: 1, color: 'Red1' }],
      faces: [[0, 1, 2]],
      starting_face: 0,
      face_positions: [1],
      next_faces: [null],
      associated_lines: [null],
    },
  };
}

function line(a: { x: number; y: number }, b: { x: number; y: number }, color: 'Red1' | 'Blue2'): OristudioCpLineSegment {
  return { a, b, color, active: 'Inactive0', selected: 0, customized: 0, customized_color: { red: 0, green: 0, blue: 0 } };
}

const LINES = [line({ x: 0, y: 0 }, { x: 1, y: 1 }, 'Red1'), line({ x: 1, y: 0 }, { x: 0, y: 1 }, 'Blue2')];

function cpState(): OristudioCpDocumentState {
  const document = createStarterOristudioCpDocument();
  return {
    handle: 4,
    loadSerial: 1,
    document: { ...document, crease_pattern: { ...document.crease_pattern, line_segments: LINES } },
    geometry: null,
    summary: {
      title: 'Untitled CP',
      line_segments: LINES.length,
      circles: 0,
      points: 0,
      aux_line_segments: 0,
      texts: 0,
      can_save_as_cp: true,
      is_empty: false,
    },
    source: { format: 'cp', filename: 'Untitled.cp', path: null },
    operationDescriptors: [],
    lastCommandResult: null,
  };
}

/** A flat figure folded from the two creases, on a slot the arena gives it, the live list holding it. */
function folded(id: string): OristudioCpFoldedFigureEntry {
  const handle = arena.take();
  retainFoldedFigureHandle(handle);
  return {
    id,
    title: id,
    handle,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 0,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    placement: IDENTITY_FOLDED_PLACEMENT,
    snapshot: snapshot(),
    renderSnapshot: renderSnapshot(),
    sourceBounds: foldedSourceBounds(LINES),
    sourceFingerprint: null,
    sourceLineIds: [1, 2],
    error: null,
  };
}

const state = () => useWorkspaceStore.getState();
const figures = () => state().oristudioCpFoldedFigures;

/** A fold as the canvas makes one: a new figure, one undo entry. */
async function foldAsEntry(id: string): Promise<OristudioCpFoldedFigureEntry> {
  const figure = folded(id);
  await foldedFigureGesture.run('verb', 'Fold model', () => {
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [...figures(), figure] });
  });
  return figure;
}

/** Restyle `id`: a render through its handle, which fails on a slot that is not live. */
async function restyle(id: string) {
  await state().setOristudioCpFoldedFigureDisplayStyle(id, 'Transparent3');
  return figures().find((figure) => figure.id === id);
}

beforeEach(async () => {
  await resetFoldedFigureHandles();
  arena.live.clear();
  arena.freed.length = 0;
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: cpState(),
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpError: null,
  });
});

describe('a folded figure’s handle across Delete, Refold and undo', () => {
  it('keeps a deleted figure’s fold for its undo, which puts back a figure that still draws', async () => {
    const figure = await foldAsEntry('generated-1');

    await deleteFoldedFigure(figure.id, t);
    expect(figures()).toEqual([]);
    expect(arena.freed).toEqual([]);
    // Held by the entry alone now.
    expect(foldedFigureHandleRefCount(figure.handle!)).toBe(1);

    await state().undo();
    expect(figures().map((entry) => entry.handle)).toEqual([figure.handle]);
    expect(foldedFigureHandleRefCount(figure.handle!)).toBe(1);
    expect(await restyle(figure.id)).toMatchObject({ status: 'ready', displayStyle: 'Transparent3', error: null });
    expect(arena.freed).toEqual([]);

    // Redo deletes it again; the redo entry keeps the fold.
    await state().redo();
    expect(figures()).toEqual([]);
    expect(foldedFigureHandleRefCount(figure.handle!)).toBe(1);
    expect(arena.freed).toEqual([]);
  });

  it('keeps the fold a Refold replaced for its undo, and the new one for the redo', async () => {
    const figure = await foldAsEntry('generated-1');
    const before = figure.handle!;

    await foldedFigureGesture.run('verb', 'Refold folded model', () => state().refoldOristudioCpFoldedFigure(figure.id));
    const after = figures()[0]!.handle!;
    expect(after).not.toBe(before);
    expect(arena.freed).toEqual([]);
    expect([foldedFigureHandleRefCount(before), foldedFigureHandleRefCount(after)]).toEqual([1, 1]);

    await state().undo();
    expect(figures()[0]!.handle).toBe(before);
    expect(await restyle(figure.id)).toMatchObject({ status: 'ready', error: null });
    expect([foldedFigureHandleRefCount(before), foldedFigureHandleRefCount(after)]).toEqual([1, 1]);

    await state().redo();
    expect(figures()[0]!.handle).toBe(after);
    expect(await restyle(figure.id)).toMatchObject({ status: 'ready', error: null });
    expect([foldedFigureHandleRefCount(before), foldedFigureHandleRefCount(after)]).toEqual([1, 1]);
    expect(arena.freed).toEqual([]);
  });

  it('never gives a deleted figure’s slot to the next fold while its undo can put it back', async () => {
    const first = await foldAsEntry('generated-1');
    await deleteFoldedFigure(first.id, t);
    // The kernel hands the next fold the first free slot: not the deleted figure's, which history keeps.
    const second = await foldAsEntry('generated-2');
    expect(second.handle).not.toBe(first.handle);

    await state().undo(); // the second fold
    await state().undo(); // the delete
    expect(figures().map((entry) => [entry.id, entry.handle])).toEqual([[first.id, first.handle]]);
    expect(await restyle(first.id)).toMatchObject({ status: 'ready', error: null });
    expect(arena.freed).toEqual([]);
  });

  it('lets go of a fold once no entry can reach it', async () => {
    const figure = await foldAsEntry('generated-1');
    await deleteFoldedFigure(figure.id, t);
    state().clearHistory();
    expect(arena.freed).toEqual([figure.handle]);
    expect(foldedFigureHandleRefCount(figure.handle!)).toBe(0);
  });
});

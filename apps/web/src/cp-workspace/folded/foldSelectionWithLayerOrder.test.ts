import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldSource,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { LayerOrderDialogOutcome } from '../../layer-order/dialog/layerOrderDialogGateway';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { FOLD_MAGNITUDE_FULL } from '../../lib/foldAngle';

/**
 * "Fold with layer order…" (row H5) over the store, with the kernel's figure
 * arena stood in for — a fold takes the lowest free slot, a free gives it back,
 * and reading a slot that is not live fails — and the Layer order dialog's one
 * door answering as each test says. Every way the press can end leaves each
 * fold held exactly as often as something refers to it: the dialog's own fold
 * by nothing once the dialog has closed, the new figure's by the live list and
 * history.
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
  read(handle: number): void {
    if (!this.live.has(handle)) throw new Error(`no folded figure in slot ${handle}`);
  },
}));

/** What the kernel answers next, and what it was asked. */
const kernel = vi.hoisted(() => ({
  /** The relations each fold was given, in order. */
  folds: [] as number[][],
  /** How the next folds end, first to last; past the list, they fold. */
  next: [] as Array<'ok' | 'stop' | 'refuse' | 'unsolved' | 'other-faces' | 'fail'>,
  /** Slots folded on other faces than the dialog analysed, which answer another digest. */
  otherFaces: new Set<number>(),
  /** Holds the next fold's answer until opened, to press again meanwhile. */
  gate: null as Promise<void> | null,
  checks: 0,
}));

/** The dialog's door: its answer is each test's to give. */
const dialog = vi.hoisted(() => ({
  requests: [] as LayerOrderRequest[],
  answer: (_request: LayerOrderRequest): Promise<LayerOrderDialogOutcome> =>
    Promise.resolve({ kind: 'cancelled' }),
}));

const analytics = vi.hoisted(() => ({ track: vi.fn() }));

const DIGEST = '0123456789abcdef';

vi.mock('../../store/workspaceStore/oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/workspaceStore/oristudioCpRuntime')>();
  return {
    ...actual,
    freeOristudioCpFoldedFigure: async (handle: number) => {
      arena.freed.push(handle);
      arena.live.delete(handle);
    },
    getOristudioCpSelectionFoldSource: async (): Promise<OristudioCpFoldSource> => source(),
    // A plain fold, for the one test that compares with it.
    foldOristudioCpDocument: async () => ({
      handle: arena.take(),
      snapshot: snapshot({ outcome: 'Solved', given: false }),
    }),
    foldOristudioCpWithOrder: async (_source: OristudioCpFoldSource, relations: Uint32Array) => {
      kernel.folds.push([...relations]);
      if (kernel.gate) await kernel.gate;
      const how = kernel.next.shift();
      if (how === 'stop') throw { code: 'fold_cancelled', message: 'stopped' };
      if (how === 'fail') throw new Error('The crease pattern could not be folded');
      if (how === 'refuse') return { status: 'refused', refusal: { code: 'not_found' } };
      const handle = arena.take();
      if (how === 'other-faces') kernel.otherFaces.add(handle);
      return {
        status: 'folded',
        handle,
        snapshot: snapshot({ outcome: how === 'unsolved' ? 'Contradiction' : 'Solved', given: relations.length > 0 }),
      };
    },
    getOristudioCpFoldedFigureDigest: async (handle: number) => {
      arena.read(handle);
      return kernel.otherFaces.has(handle) ? 'fedcba9876543210' : DIGEST;
    },
    getOristudioCpFoldedFigurePaperScene: async (handle: number) => {
      arena.read(handle);
      return SCENE;
    },
    // A figure's own fold, for Layer order… on a figure (H3), which the press guard covers too.
    getOristudioCpFoldedFigureSnapshot: async (handle: number) => {
      arena.read(handle);
      return snapshot({ outcome: 'Solved', given: false });
    },
    getOristudioCpFoldedFigureSource: async (handle: number) => {
      arena.read(handle);
      return source();
    },
    getOristudioCpFoldedFigureRenderSnapshot: async (handle: number) => {
      arena.read(handle);
      return renderSnapshot();
    },
    runOristudioCpCheckCommand: async () => {
      kernel.checks += 1;
      return { operation: 'CheckCamv', status: 'OracleTested', diagnostics: [], diagnostic_entries: [] };
    },
    isCurrentOristudioCpDocumentState: () => true,
  };
});

vi.mock('../../layer-order/dialog/layerOrderDialogGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../layer-order/dialog/layerOrderDialogGateway')>();
  return {
    ...actual,
    prefetchLayerOrderDialog: () => {},
    openLayerOrderDialog: (request: LayerOrderRequest) => {
      dialog.requests.push(request);
      return dialog.answer(request);
    },
  };
});

/** The app's toasts, by kind: a refusal that is no fault is a message, never an error. */
const toasts = vi.hoisted(() => ({ message: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** The canvas's sheet index, as each test sets it: none unless it says. */
const sheets = vi.hoisted(() => ({ index: null as import('../../engine/oristudioCpSheetIndex').CpSheetIndex | null }));
vi.mock('../sheets/cpSheetIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sheets/cpSheetIndex')>()),
  peekCpSheetIndex: () => sheets.index,
  ensureCpSheetIndex: async () => sheets.index,
}));

vi.mock('../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analytics')>();
  return { ...actual, track: analytics.track };
});

import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { useSettingsStore } from '../../store/settingsStore';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { twoConstraintRecord } from '../../lib/layerOrder/layerOrderRecord.fixtures';
import {
  foldedFigureHandleRefCount,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from './foldedFigureHandles';
import { foldSelectionWithLayerOrder } from './foldSelectionWithLayerOrder';
import { isFoldedFigureStale } from './foldedFigureStaleness';
import { openFoldedFigureLayerOrder } from './openFoldedFigureLayerOrder';
import { effectiveObjectPaperStyle } from '../paper/objectPaperStyle';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import {
  cpDocument,
  LEFT_FOLD_LINE_IDS,
  LEFT_LINE_IDS,
  RIGHT_LINE_IDS,
  twoSquaresIndex,
} from '../../diagram/capture/capture.fixtures';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

const SCENE = { faces: [] } as unknown as OristudioCpFoldedPaperScene;

function line(a: { x: number; y: number }, b: { x: number; y: number }, color: 'Red1' | 'Blue2'): OristudioCpLineSegment {
  return { a, b, color, active: 'Inactive0', selected: 0, customized: 0, customized_color: { red: 0, green: 0, blue: 0 } };
}

const LINES = [line({ x: 0, y: 0 }, { x: 1, y: 1 }, 'Red1'), line({ x: 1, y: 0 }, { x: 0, y: 1 }, 'Blue2')];
const SELECTION = [1, 2];

function source(): OristudioCpFoldSource {
  return { segments: LINES, starting_face_id: 1, aux_segments: [], digest: DIGEST };
}

function renderSnapshot(): OristudioCpFoldedRenderSnapshot {
  return { schema_version: 1, fixture: null, pass: 'paper-front-full', primitives: [] };
}

function snapshot({
  outcome,
  given,
}: {
  outcome: 'Solved' | 'Contradiction';
  given: boolean;
}): OristudioCpFoldedFigureSnapshot {
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
    display_style: outcome === 'Solved' ? 'Paper5' : 'Transparent3',
    discovered_fold_cases: outcome === 'Solved' ? 2 : 0,
    current_fold_case: outcome === 'Solved' ? 1 : 0,
    find_another_overlap_valid: false,
    outcome,
    shown_order: given ? 'given' : 'searched',
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
  } as OristudioCpFoldedFigureSnapshot;
}

/** A crease pattern of `lines`, as load `loadSerial` opened it. */
function cpState(lines: OristudioCpLineSegment[] = LINES, loadSerial = 1): OristudioCpDocumentState {
  const document = createStarterOristudioCpDocument();
  return {
    handle: 4,
    loadSerial,
    document: { ...document, crease_pattern: { ...document.crease_pattern, line_segments: lines } },
    geometry: null,
    summary: {
      title: 'Untitled CP',
      line_segments: lines.length,
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

const state = () => useWorkspaceStore.getState();
const figures = () => state().oristudioCpFoldedFigures;

/** Every slot referred to is live and counted once per reference; every live slot is referred to. */
function expectEachFoldHeldOnce() {
  const lists = [
    figures(),
    ...state().oristudioCpHistoryPast.map((entry) => entry.foldedFigures ?? []),
    ...state().oristudioCpHistoryFuture.map((entry) => entry.foldedFigures ?? []),
  ];
  const references = new Map<number, number>();
  for (const list of lists) {
    for (const figure of list) {
      if (figure.handle != null) references.set(figure.handle, (references.get(figure.handle) ?? 0) + 1);
    }
  }
  for (const [handle, count] of references) {
    expect(arena.live.has(handle), `slot ${handle} is referred to but free`).toBe(true);
    expect(foldedFigureHandleRefCount(handle), `slot ${handle}'s count`).toBe(count);
  }
  for (const handle of arena.live) {
    expect(references.has(handle), `slot ${handle} is taken but nothing refers to it`).toBe(true);
  }
}

/** The fold events, as the dashboards read them. */
function foldEvents(name: 'fold attempted' | 'fold completed') {
  return analytics.track.mock.calls.filter(([event]) => event === name).map(([, properties]) => properties);
}

/** Apply, with the order on screen: the record and the relations the dialog saved. */
function applies(relations = [0, 1]) {
  dialog.answer = async (request) => ({
    kind: 'applied',
    applied: { record: twoConstraintRecord(), relations: new Uint32Array(relations), source: request.source },
  });
}

beforeEach(async () => {
  await resetFoldedFigureHandles();
  arena.live.clear();
  arena.freed.length = 0;
  kernel.otherFaces.clear();
  kernel.folds.length = 0;
  kernel.next.length = 0;
  kernel.gate = null;
  kernel.checks = 0;
  dialog.requests.length = 0;
  dialog.answer = async () => ({ kind: 'cancelled' });
  sheets.index = null;
  toasts.message.mockReset();
  toasts.error.mockReset();
  analytics.track.mockReset();
  useSettingsStore.setState({ foldWarningEnabled: true });
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: cpState(),
    oristudioCpRevision: 0,
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpError: null,
    error: null,
    dirty: false,
  });
});

/**
 * `text` said as the app's ordinary message, as a refusal that is no fault
 * is: no error toast, and no error for `GlobalToasts` to show as "Ori Studio
 * error".
 */
function saidAsMessage(text: string) {
  expect(toasts.message).toHaveBeenCalledWith(text);
  expect(toasts.error).not.toHaveBeenCalled();
  expect(state().error).toBeNull();
  expect(state().oristudioCpError).toBeNull();
}

describe('Fold with layer order…', () => {
  it('opens the dialog on the selection’s own fold, as the figure Apply makes would look', async () => {
    await foldSelectionWithLayerOrder(SELECTION, t);

    // Oriedita's own search on the selection's source: no order given.
    expect(kernel.folds).toEqual([[]]);
    expect(dialog.requests).toHaveLength(1);
    expect(dialog.requests[0]).toMatchObject({
      // A selection, not a figure: the dialog's events tell the two entry points apart (spec §10).
      surface: 'edit_pattern',
      record: null,
      source: { digest: DIGEST, startingFaceId: 1, segments: LINES },
      shown: SCENE,
      name: 'Selection',
      // The display style, front up, upright on the canvas, not see-through.
      look: {
        style: useSettingsStore.getState().paperStyle.display,
        side: 'front',
        turnDeg: 0,
        xray: false,
      },
    });
  });

  it.each(['cancelled', 'busy', 'unavailable'] as const)(
    '%s: no figure, no undo entry, nothing marked dirty, and its fold let go',
    async (kind) => {
      dialog.answer = async () => ({ kind });

      await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe(kind);
      expect(figures()).toEqual([]);
      expect(state().oristudioCpHistoryPast).toEqual([]);
      expect(state().dirty).toBe(false);
      expect(arena.freed).toHaveLength(1);
      expect(foldedFigureHandleRefCount(arena.freed[0]!)).toBe(0);
      expectEachFoldHeldOnce();
      // No figure was asked for, so no fold is counted.
      expect(foldEvents('fold attempted')).toEqual([]);
    }
  );

  it('Apply makes one figure with the order and its record, as one undo entry', async () => {
    applies();

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('applied');
    // The dialog's fold, then the figure's: the dialog's source, with its relations.
    expect(kernel.folds).toEqual([[], [0, 1]]);
    expect(figures()).toHaveLength(1);
    const [figure] = figures();
    expect(figure).toMatchObject({
      status: 'ready',
      sourceLineIds: SELECTION,
      layerOrder: { kind: 'record', record: twoConstraintRecord() },
    });
    expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Fold model']);
    expect(state().dirty).toBe(true);
    // The pre-fold check is asked once, at the press, and not again at Apply.
    expect(kernel.checks).toBe(1);
    // The dialog's fold is gone; the figure's is held by the figure alone.
    expect(arena.freed).toEqual([0]);
    expect(foldedFigureHandleRefCount(figure!.handle!)).toBe(1);
    expectEachFoldHeldOnce();
  });

  it('undo takes the figure away, keeping its fold for the redo, which puts it back', async () => {
    applies();
    await foldSelectionWithLayerOrder(SELECTION, t);
    const [figure] = figures();

    await state().undo();
    expect(figures()).toEqual([]);
    expect(arena.live.has(figure!.handle!)).toBe(true);
    expectEachFoldHeldOnce();

    await state().redo();
    expect(figures().map((entry) => [entry.id, entry.handle, entry.layerOrder?.kind])).toEqual([
      [figure!.id, figure!.handle, 'record'],
    ]);
    expectEachFoldHeldOnce();
  });

  it('Apply on the order it opened on folds Oriedita’s order, with no record, as Fold does', async () => {
    dialog.answer = async () => ({ kind: 'unchanged' });

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('unchanged');
    expect(kernel.folds).toEqual([[], []]);
    expect(figures()).toHaveLength(1);
    expect(figures()[0]?.layerOrder).toBeUndefined();
    expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Fold model']);
    expectEachFoldHeldOnce();
  });

  it.each([
    ['an Apply', 'applied'],
    ['an Apply that only turned it', 'unchanged'],
  ] as const)('the new figure starts at the turn the dialog’s Rotate left, in the fold’s one entry: %s', async (_what, kind) => {
    const plain = { kind: 'unchanged' } as const;
    // Where a fold with no turn places it, upright on the canvas.
    dialog.answer = async () => plain;
    await foldSelectionWithLayerOrder(SELECTION, t);
    const upright = figures()[0]!.placement.rotation;
    await state().undo();

    dialog.answer = async (request) =>
      kind === 'applied'
        ? {
            kind,
            applied: { record: twoConstraintRecord(), relations: new Uint32Array([0, 1]), source: request.source },
            turnDeg: 30,
          }
        : { kind, turnDeg: 30 };
    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe(kind);
    const [figure] = figures();
    expect(figure!.placement.rotation).toBeCloseTo(upright + Math.PI / 6, 12);
    expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Fold model']);
    await state().undo();
    expect(figures()).toEqual([]);
  });

  it.each([
    ['refused', 'refuse'],
    ['drawn on other faces', 'other-faces'],
    ['not reached whole', 'unsolved'],
  ] as const)('an order the kernel %s makes nothing, and says so', async (_what, how) => {
    applies();
    // The dialog's fold folds; the figure's ends as `how`.
    kernel.next = ['ok', how];

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('applied');
    expect(figures()).toEqual([]);
    expect(state().oristudioCpHistoryPast).toEqual([]);
    expect(state().oristudioCpError).toBe('Layer order couldn’t fold these creases in this order.');
    expect(arena.live.size).toBe(0);
    expectEachFoldHeldOnce();
  });

  it('a Stop while the figure folds makes nothing and says nothing', async () => {
    applies();
    kernel.next = ['ok', 'stop'];

    await foldSelectionWithLayerOrder(SELECTION, t);
    expect(figures()).toEqual([]);
    expect(state().oristudioCpHistoryPast).toEqual([]);
    expect(state().oristudioCpError).toBeNull();
    expect(arena.live.size).toBe(0);
  });

  it('a Stop while the selection folds opens nothing and leaves nothing', async () => {
    kernel.next = ['stop'];

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('not-opened');
    expect(dialog.requests).toEqual([]);
    expect(state().oristudioCpError).toBeNull();
    expect(arena.live.size).toBe(0);
  });

  it('a fold that fails opens nothing, leaves nothing, and says why as the fault it is: an error', async () => {
    kernel.next = ['fail'];

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('not-opened');
    expect(dialog.requests).toEqual([]);
    expect(state().oristudioCpError).toBe('The crease pattern could not be folded');
    // `GlobalToasts` shows this one as "Ori Studio error"; nothing says it as a message.
    expect(state().error).toMatchObject({ message: 'The crease pattern could not be folded' });
    expect(toasts.message).not.toHaveBeenCalled();
    expect(arena.live.size).toBe(0);
  });

  it('creases Oriedita finds no layer order for open nothing (D3), say so as a message, and their fold is let go', async () => {
    kernel.next = ['unsolved'];

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('not-opened');
    expect(dialog.requests).toEqual([]);
    saidAsMessage('Layer order couldn’t be determined for these creases.');
    expect(arena.freed).toEqual([0]);
    expect(arena.live.size).toBe(0);
  });

  // What the kernel answers for such creases with no order given (`in_closure` on
  // `failing_global_flat_fold.ori`, which a plain Fold draws see-through): the same D3
  // refusal, not "These creases have no flat folded form to draw", and no fault, so a
  // message rather than an "Ori Studio error".
  it('a fold the kernel refuses for want of an order says D3’s words as a message, not an error, and holds nothing', async () => {
    kernel.next = ['refuse'];

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('not-opened');
    expect(dialog.requests).toEqual([]);
    saidAsMessage('Layer order couldn’t be determined for these creases.');
    expect(toasts.message).toHaveBeenCalledOnce();
    expect(arena.live.size).toBe(0);
  });

  it('creases that fold in 3D are refused before anything folds, as a message', async () => {
    useWorkspaceStore.setState({
      oristudioCpDocument: cpState(LINES.map((segment) => ({ ...segment, fold_magnitude: FOLD_MAGNITUDE_FULL / 2 }))),
    });

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('not-opened');
    expect(kernel.folds).toEqual([]);
    saidAsMessage('Layer order works on flat folds');
  });

  it('a second press while the first folds is refused, and folds nothing', async () => {
    let open = () => {};
    kernel.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = foldSelectionWithLayerOrder(SELECTION, t);
    await vi.waitFor(() => expect(kernel.folds).toHaveLength(1));

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('not-opened');
    kernel.gate = null;
    open();
    await expect(first).resolves.toBe('cancelled');
    expect(kernel.folds).toHaveLength(1);
    expect(arena.live.size).toBe(0);
  });

  it('tags the figure’s fold `via: layer_order`, once attempted and once completed', async () => {
    applies();
    await foldSelectionWithLayerOrder(SELECTION, t);

    expect(foldEvents('fold attempted')).toEqual([
      expect.objectContaining({ mode: 'flat', via: 'layer_order' }),
    ]);
    expect(foldEvents('fold completed')).toEqual([
      expect.objectContaining({ mode: 'flat', verdict: 'folded', via: 'layer_order' }),
    ]);
  });

  it('leaves a plain fold untagged', async () => {
    await state().foldOristudioCpDocument({ lineIds: SELECTION });
    expect(foldEvents('fold attempted')).toEqual([expect.not.objectContaining({ via: expect.anything() })]);
  });

  it('opens the dialog in the colours the figure Apply makes will have, pins and all', async () => {
    // A reopened Oriedita file's saved model: its colours become a new figure's pins (D1).
    const opened = cpState();
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        ...opened,
        document: {
          ...opened.document,
          metadata: { ...opened.document.metadata, 'oriedita:ori:foldedFigureModel': { frontColor: 'ffff0000', backColor: 'ff0000ff' } },
        },
      },
    });
    dialog.answer = async () => ({ kind: 'unchanged' });

    await foldSelectionWithLayerOrder(SELECTION, t);
    const [figure] = figures();
    const display = useSettingsStore.getState().paperStyle.display;
    expect(figure?.appearance).toBeDefined();
    expect(dialog.requests[0]?.look.style).toEqual(effectiveObjectPaperStyle(figure!, display));
    expect(dialog.requests[0]?.look.style).not.toEqual(display);
  });

  it('a second press while the dialog is open is refused at once: no check, no fold', async () => {
    let close = () => {};
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    dialog.answer = async () => {
      await closed;
      return { kind: 'cancelled' };
    };
    const first = foldSelectionWithLayerOrder(SELECTION, t);
    await vi.waitFor(() => expect(dialog.requests).toHaveLength(1));

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('not-opened');
    expect(kernel.checks).toBe(1);
    expect(kernel.folds).toHaveLength(1);
    close();
    await expect(first).resolves.toBe('cancelled');
    expect(arena.live.size).toBe(0);

    // Once it has closed, a press goes ahead.
    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('cancelled');
    expect(kernel.folds).toHaveLength(2);
  });
});

/**
 * What the press found (`foldPress.ts`): a crease edited or another document
 * opened after the press stops it before the dialog opens, and again before
 * Apply writes, with nothing written and the reason said.
 */
describe('what a Layer order press found open', () => {
  const MOVED = 'The crease pattern changed meanwhile, so Layer order changed nothing.';
  const OTHER_LINES = [
    line({ x: 5, y: 5 }, { x: 9, y: 9 }, 'Red1'),
    line({ x: 9, y: 5 }, { x: 5, y: 9 }, 'Blue2'),
    line({ x: 5, y: 7 }, { x: 9, y: 7 }, 'Red1'),
  ];
  /** As a crease edit commits: the document's edit count moves on. */
  const editACrease = () => useWorkspaceStore.setState({ oristudioCpRevision: state().oristudioCpRevision + 1 });
  /** As File ▸ Open or New: every handle torn down, another crease pattern in, its history empty. */
  async function openAnotherDocument(figuresThere: OristudioCpFoldedFigureEntry[] = []) {
    await resetFoldedFigureHandles();
    useWorkspaceStore.setState({
      oristudioCpDocument: cpState(OTHER_LINES, 2),
      oristudioCpRevision: 0,
      oristudioCpFoldedFigures: figuresThere,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      dirty: false,
    });
  }

  it('a crease edited while the press folds: its fold let go, the dialog never opens', async () => {
    let open = () => {};
    kernel.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const press = foldSelectionWithLayerOrder(SELECTION, t);
    await vi.waitFor(() => expect(kernel.folds).toHaveLength(1));
    editACrease();
    kernel.gate = null;
    open();

    await expect(press).resolves.toBe('not-opened');
    expect(dialog.requests).toEqual([]);
    saidAsMessage(MOVED);
    expect(arena.freed).toEqual([0]);
    expect(arena.live.size).toBe(0);
  });

  it('a crease edited while the dialog is open: Apply folds nothing and writes nothing', async () => {
    dialog.answer = async (request) => {
      editACrease();
      return { kind: 'applied', applied: { record: twoConstraintRecord(), relations: new Uint32Array([0, 1]), source: request.source } };
    };

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('applied');
    expect(kernel.folds).toEqual([[]]);
    expect(figures()).toEqual([]);
    expect(state().oristudioCpHistoryPast).toEqual([]);
    expect(state().dirty).toBe(false);
    saidAsMessage(MOVED);
    expect(foldEvents('fold attempted')).toEqual([]);
    expect(arena.live.size).toBe(0);
  });

  it('another document opened while the dialog is open: Apply lands nothing in it', async () => {
    dialog.answer = async (request) => {
      await openAnotherDocument();
      return { kind: 'applied', applied: { record: twoConstraintRecord(), relations: new Uint32Array([0, 1]), source: request.source } };
    };

    await expect(foldSelectionWithLayerOrder(SELECTION, t)).resolves.toBe('applied');
    expect(kernel.folds).toEqual([[]]);
    expect(figures()).toEqual([]);
    expect(state().oristudioCpHistoryPast).toEqual([]);
    saidAsMessage(MOVED);
    expect(arena.live.size).toBe(0);
  });

  it('the creases put back by an undo the count cannot see: the figure lands as the press found them, and reads stale', async () => {
    // An undo restores the crease pattern without moving its edit count, so
    // the press goes ahead; the figure is still the press's creases'.
    dialog.answer = async () => {
      useWorkspaceStore.setState({ oristudioCpDocument: cpState([...LINES, line({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 'Red1')]) });
      return { kind: 'unchanged' };
    };

    await foldSelectionWithLayerOrder(SELECTION, t);
    const [figure] = figures();
    expect(figure).toMatchObject({ sourceCpRevision: 0, sourceLineIds: SELECTION });
    expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figure!)).toBe(true);
  });

  describe('Layer order… on a figure (H3)', () => {
    /** A flat figure folded from the two creases, its fold live, the live list holding it. */
    function seedFigure(id = 'generated-1'): OristudioCpFoldedFigureEntry {
      const handle = arena.take();
      retainFoldedFigureHandle(handle);
      const figure: OristudioCpFoldedFigureEntry = {
        id,
        title: id,
        handle,
        sourceKind: 'generated-from-current-cp',
        sourceCpRevision: 0,
        startingFaceId: 1,
        displayStyle: 'Paper5',
        status: 'ready',
        placement: IDENTITY_FOLDED_PLACEMENT,
        snapshot: snapshot({ outcome: 'Solved', given: false }),
        renderSnapshot: renderSnapshot(),
        sourceBounds: null,
        sourceFingerprint: null,
        sourceLineIds: SELECTION,
        error: null,
      };
      useWorkspaceStore.setState({ oristudioCpFoldedFigures: [...figures(), figure] });
      return figure;
    }

    it('another document opened while its dialog is open: Apply writes nothing onto the figure there with the same id', async () => {
      const figure = seedFigure();
      let there: OristudioCpFoldedFigureEntry | null = null;
      dialog.answer = async (request) => {
        await openAnotherDocument();
        there = seedFigure(figure.id);
        return { kind: 'applied', applied: { record: twoConstraintRecord(), relations: new Uint32Array([0, 1]), source: request.source } };
      };

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('applied');
      expect(kernel.folds).toEqual([]);
      expect(figures()).toEqual([there]);
      expect(state().oristudioCpHistoryPast).toEqual([]);
      saidAsMessage(MOVED);
    });

    it('a crease edited while its dialog is open: Apply writes nothing', async () => {
      const figure = seedFigure();
      dialog.answer = async (request) => {
        editACrease();
        return { kind: 'applied', applied: { record: twoConstraintRecord(), relations: new Uint32Array([0, 1]), source: request.source } };
      };

      await openFoldedFigureLayerOrder(figure.id, t);
      expect(kernel.folds).toEqual([]);
      expect(figures()).toEqual([figure]);
      expect(state().oristudioCpHistoryPast).toEqual([]);
      saidAsMessage(MOVED);
    });

    it('nothing moved: Apply sets the order, as before', async () => {
      const figure = seedFigure();
      applies();

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('applied');
      expect(kernel.folds).toEqual([[0, 1]]);
      expect(figures()[0]).toMatchObject({ id: figure.id, layerOrder: { kind: 'record' } });
      expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Set layer order']);
    });
  });
});

describe('the crease pattern the dialog shows, on a canvas of two', () => {
  // Two squares side by side, each its own sheet; the left one holds an aux line (10).
  const twoSquares = () => cpDocument().crease_pattern.line_segments;
  const LEFT = { paper: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]], auxSegments: [twoSquares()[9]] };

  beforeEach(() => {
    useWorkspaceStore.setState({ oristudioCpDocument: cpState(twoSquares()) });
    sheets.index = twoSquaresIndex();
  });

  it('Fold with layer order… on one square: that square alone, its paper and its own aux line', async () => {
    await foldSelectionWithLayerOrder(LEFT_LINE_IDS, t);
    expect(dialog.requests[0]!.region).toEqual(LEFT);
    // Its creases alone, the aux line unselected: the same square.
    await foldSelectionWithLayerOrder(LEFT_FOLD_LINE_IDS, t);
    expect(dialog.requests[1]!.region).toEqual(LEFT);
  });

  it('a selection across both squares, or a canvas with no sheets yet: no region, so the pane frames the creases', async () => {
    await foldSelectionWithLayerOrder([...LEFT_FOLD_LINE_IDS, ...RIGHT_LINE_IDS], t);
    expect(dialog.requests[0]!.region).toBeUndefined();
    sheets.index = null;
    await foldSelectionWithLayerOrder(LEFT_LINE_IDS, t);
    expect(dialog.requests[1]!.region).toBeUndefined();
  });

  it('Layer order… on a figure: the square its provenance box reselects, as its refold would', async () => {
    const handle = arena.take();
    retainFoldedFigureHandle(handle);
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: snapshot({ outcome: 'Solved', given: false }),
      renderSnapshot: renderSnapshot(),
      sourceBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      sourceFingerprint: null,
      // Ids from before an edit renumbered them: the box, not these, finds the square.
      sourceLineIds: RIGHT_LINE_IDS,
      error: null,
    };
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [figure] });
    await openFoldedFigureLayerOrder(figure.id, t);
    expect(dialog.requests[0]!.region).toEqual(LEFT);
  });
});

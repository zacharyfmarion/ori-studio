import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpCommandPayload,
  OristudioCpDocumentSnapshot,
  OristudioCpSelectedLines,
} from '../../engine/oristudioCpTypes';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { createStep } from '../../diagram/document/diagramDocument';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { MAX_CP_HISTORY } from './cpHistory';
import type { OristudioCpHistoryEntry } from './types';

/**
 * Selections through the store against the real CP kernel, in Node: the kernel
 * answers a selection with the selected lines, and the store keeps its
 * snapshot. Two copies of the selection have to stay right — the store's ids,
 * which the canvas draws, and the kernel's flags, which region commands read —
 * through undo, redo, the edits around them and a deselect.
 *
 * The kernel stands in for the worker as an in-process client over the same
 * wasm calls. Skipped when the bridge has not been built; CI builds it first.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const wasmAvailable = existsSync(WASM);
type CpWasm = typeof import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');

const kernel = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../engines/engineHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engines/engineHost')>();
  return {
    ...actual,
    connectEngine: async () => kernel.client,
    isEngineConnected: () => kernel.client !== null,
  };
});

/** Calls the in-process kernel has run and not yet answered. */
let unanswered = 0;

/**
 * As the worker does: a call reaches the kernel the moment it is made, so calls
 * run in the order they are made, and its answer arrives in a later task. That
 * is what lets one call land while another is still in flight.
 */
function answerLater<T>(call: () => T): Promise<T> {
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: call() };
  } catch (error) {
    outcome = { error };
  }
  unanswered += 1;
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      unanswered -= 1;
      if ('error' in outcome) reject(outcome.error);
      else resolve(outcome.value);
    }, 0)
  );
}

/**
 * `geometry` as the worker receives it: a copy, which is what posting it
 * without `transfer` makes. Copied array by array rather than with
 * `structuredClone`, whose arrays come from another realm under jsdom and fail
 * the bridge's `instanceof` checks.
 */
function posted(geometry: CpGeometryTransport): CpGeometryTransport {
  return {
    ...geometry,
    segEndpoints: geometry.segEndpoints.slice(),
    segAttr: geometry.segAttr.slice(),
    segCustomColor: geometry.segCustomColor.slice(),
    segFoldMagnitude: geometry.segFoldMagnitude?.slice(),
    auxEndpoints: geometry.auxEndpoints.slice(),
    auxAttr: geometry.auxAttr.slice(),
    auxCustomColor: geometry.auxCustomColor.slice(),
    pointCoords: geometry.pointCoords.slice(),
    circleData: geometry.circleData.slice(),
    circleAttr: geometry.circleAttr.slice(),
    circleCustomColor: geometry.circleCustomColor.slice(),
    tail: structuredClone(geometry.tail),
  };
}

/** The worker's API, the parts a selection reaches, over the wasm calls the worker makes. */
function inProcessClient(wasm: CpWasm) {
  return {
    operationDescriptors: () => answerLater(() => wasm.cp_operation_descriptors()),
    loadCp: (text: string, title = '') => answerLater(() => wasm.load_cp(text, title)),
    documentGeometry: (handle: number) => answerLater(() => wasm.document_geometry(handle)),
    summary: (handle: number) => answerLater(() => wasm.document_summary(handle)),
    sheetIndex: (handle: number) => answerLater(() => wasm.sheet_index(handle)),
    executeCommand: (
      handle: number,
      operationId: OristudioCpOperationId,
      payload: OristudioCpCommandPayload = {}
    ) => answerLater(() => wasm.execute_cp_command(handle, operationId, payload)),
    executeSelectionCommand: (
      handle: number,
      operationId: OristudioCpOperationId,
      payload: OristudioCpCommandPayload = {}
    ) => answerLater(() => wasm.execute_cp_selection_command(handle, operationId, payload)),
    setSelectedLines: (handle: number, lines: OristudioCpSelectedLines) =>
      answerLater(() => wasm.set_selected_lines(handle, lines.ids, lines.values)),
    restoreDocument: (handle: number, document: OristudioCpDocumentSnapshot) =>
      answerLater(() => wasm.restore_document(handle, document)),
    restoreFromCompact: (handle: number, geometry: CpGeometryTransport) =>
      answerLater(() => wasm.restore_from_compact(handle, posted(geometry))),
    appendDisjoint: (handle: number, parts: CpGeometryTransport[], replaceStarter: boolean) =>
      answerLater(() => wasm.append_disjoint(handle, parts, replaceStarter) as [number, number][]),
    freeDocument: (handle: number) => answerLater(() => wasm.free_document(handle)),
  };
}

/** Four separate mountain creases, one unit apart, ids 1-4 from the bottom. */
const PARALLEL_CP = '2 0 0 1 0\n2 0 1 1 1\n2 0 2 1 2\n2 0 3 1 3\n';

/** A box drag over the creases at heights `from..=to`. */
function boxOver(from: number, to: number, additive = false): OristudioCpCommandPayload {
  return {
    points: [
      { x: -0.5, y: from - 0.5 },
      { x: 1.5, y: to + 0.5 },
    ],
    replace_selection: !additive,
  };
}

describe.skipIf(!wasmAvailable)('selection commands against the kernel', () => {
  let wasm: CpWasm;
  let store: typeof import('./store').useWorkspaceStore;

  beforeAll(async () => {
    wasm = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    kernel.client = inProcessClient(wasm);
    store = (await import('./store')).useWorkspaceStore;
  });

  beforeEach(async () => {
    const { loadOristudioCpDocumentFromText } = await import('./oristudioCpRuntime');
    const documentState = await loadOristudioCpDocumentFromText(PARALLEL_CP, {
      format: 'cp',
      filename: 'parallel.cp',
    });
    store.setState({
      oristudioCpDocument: documentState,
      oristudioCpSelection: emptyOristudioCpSelection(),
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      // The Edit canvas, which is what makes undo the crease pattern's.
      activePanelId: 'crease-pattern',
      dirty: false,
    });
    expect(store.getState().activeEditingContext).toBe('crease-pattern');
  });

  const state = () => store.getState();
  const storeIds = () => state().oristudioCpSelection.lines;
  /** The kernel's own flags, read from the kernel. */
  const kernelIds = () => {
    const handle = state().oristudioCpDocument?.handle;
    if (handle === undefined) throw new Error('no document');
    const document = wasm.document_snapshot(handle) as OristudioCpDocumentSnapshot;
    return document.crease_pattern.line_segments.flatMap((line, index) =>
      line.selected === 0 ? [] : [index + 1]
    );
  };
  /** The flags on the store's snapshot, which an `.osf` save writes. */
  const snapshotIds = () =>
    (state().oristudioCpDocument?.document.crease_pattern.line_segments ?? []).flatMap(
      (line, index) => (line.selected === 0 ? [] : [index + 1])
    );
  const select = (payload: OristudioCpCommandPayload, operation: OristudioCpOperationId = 'CreaseSelect') =>
    state().executeOristudioCpCommand(operation, payload);

  it('answers a box select with the lines it selected and keeps the document', async () => {
    const before = state().oristudioCpDocument;
    const artifactRevision = state().foldArtifactRevision;

    await expect(select(boxOver(0, 1))).resolves.toBe(true);

    expect(storeIds()).toEqual([1, 2]);
    expect(kernelIds()).toEqual([1, 2]);
    expect(snapshotIds()).toEqual([1, 2]);
    // The same creases, so the same objects: nothing keyed on them rebuilds.
    expect(state().oristudioCpDocument?.document).toBe(before?.document);
    expect(state().oristudioCpDocument?.geometry).toBe(before?.geometry);
    expect(state().foldArtifactRevision).toBe(artifactRevision);
    expect(state().dirty).toBe(true);
    // One undo step, holding what it replaced and no document at all.
    const entry = state().oristudioCpHistoryPast.at(-1);
    expect(entry?.label).toBe('CreaseSelect');
    expect(entry?.document).toBeUndefined();
    expect(Array.from(entry?.selectedLines?.ids ?? [-1])).toEqual([]);
  });

  /**
   * Pins today's behaviour, not the behaviour anyone wants: a click selects in
   * the store alone, so the kernel never hears of it, and a Shift+drag that
   * means "add" is answered from the kernel's flags, which drops the click.
   * See `cp-selection-two-sources-of-truth`; fixing it should change this test.
   */
  it('drops a clicked crease from an additive box select (the known two-copies bug)', async () => {
    state().toggleOristudioCpLineSelection(4);
    expect(storeIds()).toEqual([4]);
    expect(kernelIds()).toEqual([]);

    await select(boxOver(0, 0, true));

    expect(storeIds()).toEqual([1]);
    expect(kernelIds()).toEqual([1]);
  });

  it('undoes and redoes a selection in both the store and the kernel', async () => {
    const document = state().oristudioCpDocument?.document;
    await select(boxOver(0, 1));
    await select(boxOver(2, 2, true));
    expect(storeIds()).toEqual([1, 2, 3]);

    await state().undo();
    expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[1, 2], [1, 2], [1, 2]]);
    await state().undo();
    expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[], [], []]);
    await state().redo();
    expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[1, 2], [1, 2], [1, 2]]);
    await state().redo();
    expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
    expect(state().oristudioCpDocument?.document).toBe(document);
    expect(state().oristudioCpHistoryFuture).toHaveLength(0);
  });

  it('undoes an unselect back to the selection it narrowed', async () => {
    await select(boxOver(0, 3));
    await select(boxOver(1, 2), 'CreaseUnselect');
    expect([storeIds(), kernelIds()]).toEqual([[1, 4], [1, 4]]);

    await state().undo();
    expect([storeIds(), kernelIds()]).toEqual([[1, 2, 3, 4], [1, 2, 3, 4]]);
  });

  /**
   * The edit's undo entry keeps the snapshot it replaced, and puts it back into
   * the kernel: flags and all. So the selection made just before the edit has
   * to be on that snapshot, or undoing the edit would quietly clear it in the
   * kernel and the next additive select would drop it.
   */
  it('undoes an edit made after a selection back to that selection', async () => {
    await select(boxOver(0, 1));
    await expect(
      state().executeOristudioCpCommand('CreaseMakeValley', { line_ids: [1, 2] })
    ).resolves.toBe(true);

    await state().undo();
    expect([storeIds(), kernelIds()]).toEqual([[1, 2], [1, 2]]);
    const colors = state().oristudioCpDocument?.document.crease_pattern.line_segments.map(
      (line) => line.color
    );
    expect(colors).toEqual(['Red1', 'Red1', 'Red1', 'Red1']);

    await select(boxOver(3, 3, true));
    expect(storeIds()).toEqual([1, 2, 4]);
  });

  it('deselects in the kernel without fetching the document again', async () => {
    await select(boxOver(0, 1));
    const document = state().oristudioCpDocument?.document;

    state().clearOristudioCpSelection();
    await vi.waitFor(() => expect(kernelIds()).toEqual([]));
    await vi.waitFor(() => expect(state().oristudioCpDocument?.lastCommandResult).toBeNull());

    expect(storeIds()).toEqual([]);
    expect(snapshotIds()).toEqual([]);
    expect(state().oristudioCpDocument?.document).toBe(document);
  });

  /**
   * An edit's undo entry holds the compact geometry the store held, not the
   * snapshot decoded from it, and undo and redo put it back with
   * `restore_from_compact`. One entry is restored as often as the user goes
   * back and forth over it, so each restore must leave it whole.
   */
  describe('compact undo entries', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const client = () => kernel.client as ReturnType<typeof inProcessClient>;
    const colors = () =>
      state().oristudioCpDocument?.document.crease_pattern.line_segments.map((line) => line.color);
    const geometryOf = (entry: OristudioCpHistoryEntry | undefined) =>
      entry?.document && 'geometry' in entry.document ? entry.document.geometry : null;

    it('keeps the geometry the store held and restores from it each time', async () => {
      const compact = vi.spyOn(client(), 'restoreFromCompact');
      const structured = vi.spyOn(client(), 'restoreDocument');
      await select(boxOver(0, 1));
      const before = state().oristudioCpDocument;
      await state().executeOristudioCpCommand('CreaseSetLineColor', {
        line_ids: [1],
        line_color: 'Cyan3',
      });

      // The very arrays the store held, with the selection written into them.
      expect(geometryOf(state().oristudioCpHistoryPast.at(-1))).toBe(before?.geometry);

      for (let round = 0; round < 3; round += 1) {
        await state().undo();
        expect(colors()).toEqual(['Red1', 'Red1', 'Red1', 'Red1']);
        expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[1, 2], [1, 2], [1, 2]]);
        await state().redo();
        expect(colors()).toEqual(['Cyan3', 'Red1', 'Red1', 'Red1']);
        expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[1, 2], [1, 2], [1, 2]]);
      }
      expect(compact).toHaveBeenCalledTimes(6);
      expect(structured).not.toHaveBeenCalled();
      expect(state().status).not.toBe('error');
    });

    it('keeps no document for an overlay step, either way', async () => {
      const compact = vi.spyOn(client(), 'restoreFromCompact');
      const document = state().oristudioCpDocument?.document;
      state().recordAnnotationHistory([], 'Add text');
      expect(state().oristudioCpHistoryPast.at(-1)).toMatchObject({ overlayOnly: true });
      expect(state().oristudioCpHistoryPast.at(-1)?.document).toBeUndefined();

      await state().undo();
      expect(state().oristudioCpHistoryFuture[0]).toMatchObject({ overlayOnly: true });
      expect(state().oristudioCpHistoryFuture[0]?.document).toBeUndefined();
      expect(state().oristudioCpDocument?.document).toBe(document);
      expect(compact).not.toHaveBeenCalled();
    });
  });

  /** Let every call in flight land, and whatever its answer goes on to call. */
  const settle = async () => {
    do {
      await new Promise((resolve) => setTimeout(resolve, 0));
    } while (unanswered > 0);
  };

  /**
   * A selection that lands while an edit is in flight must not write into the
   * store's snapshot: the edit has already taken that snapshot for its undo
   * entry, so undoing the edit would put the selection's flags back into the
   * kernel while the store's ids came back from the entry.
   */
  describe('while an edit is in flight', () => {
    // Edits that keep the kernel's flags, so the store's ids and the kernel's
    // flags still agree once one lands. `CreaseMakeValley` would not: Oriedita's
    // `fix2` unselects everything after it, and the store keeps its ids.
    const recolor = () =>
      state().executeOristudioCpCommand('CreaseSetLineColor', {
        line_ids: [1, 2],
        line_color: 'Cyan3',
      });
    const edits: [string, () => Promise<boolean>][] = [
      ['a command', recolor],
      ['a grid change', () => state().setOristudioCpGridSize(7)],
    ];

    it.each(edits)('a deselect leaves %s its undo snapshot', async (_, edit) => {
      await select(boxOver(0, 1));
      const editing = edit();
      state().clearOristudioCpSelection();
      await expect(editing).resolves.toBe(true);
      await settle();
      expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toHaveLength(2);

      await state().undo();
      expect(storeIds()).toEqual([1, 2]);
      expect(kernelIds()).toEqual([1, 2]);
      expect(snapshotIds()).toEqual([1, 2]);
    });

    it('a box select leaves the edit its undo snapshot', async () => {
      await select(boxOver(0, 1));
      const editing = recolor();
      const selecting = select(boxOver(2, 3));
      await Promise.all([editing, selecting]);
      await settle();
      expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[3, 4], [3, 4], [3, 4]]);

      // Back through the select and the edit to the first select, both copies
      // agreeing at every step.
      for (const expected of [[1, 2], [1, 2], []]) {
        await state().undo();
        expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([expected, expected, expected]);
      }
      expect(state().status).not.toBe('error');
    });

    it('a deselect leaves an undo its redo snapshot', async () => {
      await select(boxOver(0, 1));
      await recolor();
      const undoing = state().undo();
      state().clearOristudioCpSelection();
      await undoing;
      await settle();

      await state().redo();
      expect(storeIds()).toEqual([1, 2]);
      expect(kernelIds()).toEqual([1, 2]);
      expect(snapshotIds()).toEqual([1, 2]);
    });

    it('still selects in place once the edit has landed', async () => {
      await recolor();
      await state().undo();
      await state().redo();
      const document = state().oristudioCpDocument?.document;

      await select(boxOver(0, 1));
      expect(state().oristudioCpDocument?.document).toBe(document);
      expect([storeIds(), kernelIds(), snapshotIds()]).toEqual([[1, 2], [1, 2], [1, 2]]);
    });
  });

  /**
   * A diagram import appends its sheets to the Edit canvas and records one
   * compound step across Edit and Diagram (`diagramBatchImport.ts`). Its CP
   * entry holds the store's snapshot from before the import and puts it back
   * whole, flags and all, so the selections on either side of it have to leave
   * that snapshot holding the flags the store's ids agreed with.
   */
  describe('around a diagram import', () => {
    /** A 2 x 2 square sheet, imported beside the four creases. */
    const SHEET_CP = '1 0 0 2 0\n1 2 0 2 2\n1 2 2 0 2\n1 0 2 0 0\n';
    let importBatch: typeof import('./diagramBatchImport');

    beforeAll(async () => {
      importBatch = await import('./diagramBatchImport');
    });

    beforeEach(() => {
      store.setState({
        diagram: null,
        diagramHistory: { past: [], future: [] },
        diagramImportBusy: false,
      });
    });

    /** The sheet as the import prepares it: compact geometry, read in a session of its own. */
    const sheetGeometry = (): CpGeometryTransport => {
      const sheet = wasm.load_cp(SHEET_CP, 'sheet');
      try {
        return wasm.document_geometry(sheet) as CpGeometryTransport;
      } finally {
        wasm.free_document(sheet);
      }
    };
    const runImport = () =>
      importBatch.commitDiagramImport(
        [{ geometry: sheetGeometry(), steps: [createStep()] }],
        importBatch.importTarget(),
        1,
        10
      );
    const lineCount = () => state().oristudioCpDocument?.document.crease_pattern.line_segments.length;
    const stepCount = () => state().diagram?.steps.length ?? 0;
    /** A box drag over every line from `first` on: the imported sheet, wherever it was placed. */
    const boxOverLinesFrom = (first: number): OristudioCpCommandPayload => {
      const lines = state().oristudioCpDocument?.document.crease_pattern.line_segments.slice(first - 1) ?? [];
      const xs = lines.flatMap((line) => [line.a.x, line.b.x]);
      const ys = lines.flatMap((line) => [line.a.y, line.b.y]);
      return {
        points: [
          { x: Math.min(...xs) - 0.5, y: Math.min(...ys) - 0.5 },
          { x: Math.max(...xs) + 0.5, y: Math.max(...ys) + 0.5 },
        ],
        replace_selection: true,
      };
    };
    const copies = () => [storeIds(), kernelIds(), snapshotIds()];

    it('undoes and redoes a select, the import and a select, one step each', async () => {
      await select(boxOver(0, 1));
      await expect(runImport()).resolves.toBe(1);
      // The import clears the store's selection and keeps the kernel's flags, as on main.
      expect(copies()).toEqual([[], [1, 2], [1, 2]]);
      expect([lineCount(), stepCount()]).toEqual([8, 1]);
      await select(boxOverLinesFrom(5));
      expect(copies()).toEqual([[5, 6, 7, 8], [5, 6, 7, 8], [5, 6, 7, 8]]);

      const past = state().oristudioCpHistoryPast;
      expect(past.map((entry) => entry.label)).toEqual(['CreaseSelect', 'Import steps', 'CreaseSelect']);
      expect(past.map((entry) => Boolean(entry.selectedLines))).toEqual([true, false, true]);
      expect(past[1]?.compoundId).toBeDefined();
      expect(state().diagramHistory.past.at(-1)?.compoundId).toBe(past[1]?.compoundId);

      // [store ids, kernel flags, snapshot flags], creases, steps — after each undo.
      const undone = [
        [[[], [1, 2], [1, 2]], 8, 1],
        [[[1, 2], [1, 2], [1, 2]], 4, 0],
        [[[], [], []], 4, 0],
      ];
      for (const [expected, lines, steps] of undone) {
        await expect(state().undo()).resolves.toBeUndefined();
        expect([copies(), lineCount(), stepCount()]).toEqual([expected, lines, steps]);
      }
      expect(state().oristudioCpHistoryPast).toHaveLength(0);
      expect(state().oristudioCpHistoryFuture).toHaveLength(3);

      const redone = [
        [[[1, 2], [1, 2], [1, 2]], 4, 0],
        [[[], [1, 2], [1, 2]], 8, 1],
        [[[5, 6, 7, 8], [5, 6, 7, 8], [5, 6, 7, 8]], 8, 1],
      ];
      for (const [expected, lines, steps] of redone) {
        await state().redo();
        expect([copies(), lineCount(), stepCount()]).toEqual([expected, lines, steps]);
      }
      expect(state().oristudioCpHistoryPast.map((entry) => Boolean(entry.compoundId))).toEqual([
        false,
        true,
        false,
      ]);
      expect(state().oristudioCpHistoryFuture).toHaveLength(0);
      expect(state().diagramHistory.past).toHaveLength(1);
      expect(state().status).not.toBe('error');
    });

    it('still undoes an edit after the import on its own', async () => {
      await select(boxOver(0, 1));
      await runImport();
      await select(boxOverLinesFrom(5));
      await expect(
        state().executeOristudioCpCommand('CreaseSetLineColor', { line_ids: [5], line_color: 'Cyan3' })
      ).resolves.toBe(true);

      await state().undo();
      expect(state().oristudioCpDocument?.document.crease_pattern.line_segments[4]?.color).not.toBe(
        'Cyan3'
      );
      expect([copies(), lineCount(), stepCount()]).toEqual([
        [[5, 6, 7, 8], [5, 6, 7, 8], [5, 6, 7, 8]],
        8,
        1,
      ]);
      expect(state().oristudioCpHistoryPast.at(-1)?.label).toBe('CreaseSelect');
    });

    /**
     * The import takes the store's snapshot for its undo entry as it starts, so
     * a selection that lands while it runs must not write its flags into that
     * snapshot: undoing the import would put them back into the kernel under
     * the store's ids from before it.
     */
    it('leaves the import its undo snapshot when a selection lands meanwhile', async () => {
      const selecting = select(boxOver(2, 3));
      const importing = runImport();
      await Promise.all([selecting, importing]);
      await settle();
      expect([lineCount(), stepCount()]).toEqual([8, 1]);

      await state().undo();
      expect([copies(), lineCount(), stepCount()]).toEqual([[[], [], []], 4, 0]);
    });

    describe('with compact undo entries', () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      const client = () => kernel.client as ReturnType<typeof inProcessClient>;

      it('puts the canvas back from the geometry before the import, both ways, every time', async () => {
        const compact = vi.spyOn(client(), 'restoreFromCompact');
        const structured = vi.spyOn(client(), 'restoreDocument');
        const before = state().oristudioCpDocument;
        await runImport();
        const entry = state().oristudioCpHistoryPast.at(-1);
        expect(entry?.compoundId).toBeDefined();
        expect(entry?.document && 'geometry' in entry.document && entry.document.geometry).toBe(
          before?.geometry
        );

        for (let round = 0; round < 2; round += 1) {
          await state().undo();
          expect([lineCount(), stepCount()]).toEqual([4, 0]);
          await state().redo();
          expect([lineCount(), stepCount()]).toEqual([8, 1]);
        }
        // One step in each history, travelling together.
        expect(state().oristudioCpHistoryPast.map((each) => each.compoundId)).toEqual([
          entry?.compoundId,
        ]);
        expect(state().diagramHistory.past.map((each) => each.compoundId)).toEqual([
          entry?.compoundId,
        ]);
        expect(compact).toHaveBeenCalledTimes(4);
        expect(structured).not.toHaveBeenCalled();
      });

      /**
       * The cap drops the import's Edit half once enough edits follow it, and
       * the compound history then drops its Diagram half too
       * (`compoundHistory.ts`), so neither undoes half an import. The edits
       * left still undo, from their compact geometry.
       */
      it('lets the cap take the import out of both histories', async () => {
        await runImport();
        const id = state().oristudioCpHistoryPast.at(-1)?.compoundId;
        for (let edit = 0; edit < MAX_CP_HISTORY; edit += 1) {
          await state().executeOristudioCpCommand('CreaseSetLineColor', {
            line_ids: [1],
            line_color: edit % 2 === 0 ? 'Cyan3' : 'Red1',
          });
        }
        const past = state().oristudioCpHistoryPast;
        expect(past).toHaveLength(MAX_CP_HISTORY);
        expect(past.some((each) => each.compoundId === id)).toBe(false);
        expect(state().diagramHistory.past.some((each) => each.compoundId === id)).toBe(false);
        expect(past.every((each) => each.document && 'geometry' in each.document)).toBe(true);

        for (let undo = 0; undo < MAX_CP_HISTORY; undo += 1) await state().undo();
        expect(state().oristudioCpHistoryPast).toHaveLength(0);
        // Back to just after the import, which stays: its undo went with the cap.
        expect([lineCount(), stepCount()]).toEqual([8, 1]);
        expect(state().oristudioCpDocument?.document.crease_pattern.line_segments[0]?.color).toBe(
          'Red1'
        );
        expect(state().status).not.toBe('error');
      });
    });
  });

  it('runs every selection-only operation through the kernel as a selection', async () => {
    const { SELECTION_ONLY_CP_OPERATIONS } = await import('./cpSelectedLines');
    const handle = state().oristudioCpDocument?.handle ?? -1;
    for (const operation of SELECTION_ONLY_CP_OPERATIONS) {
      expect(() =>
        wasm.execute_cp_selection_command(handle, operation, {
          points: [
            { x: 0.5, y: -0.5 },
            { x: 0.6, y: 3.5 },
          ],
        })
      ).not.toThrow();
    }
    expect(() =>
      wasm.execute_cp_selection_command(handle, 'CreaseMakeValley', { line_ids: [1] })
    ).toThrow();
  });
});

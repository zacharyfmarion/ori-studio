import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { createFoldSequence } from '../document/foldSequenceDocument';
import { readFoldSequence } from '../document/foldSequenceFile';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import { createFoldTools } from '../tools/foldToolState';
import {
  clickPane, commitPreviewed, FOLD_FLOW_AVAILABLE, foldFlowBridge, FoldFlowCanvas,
  shownPickIndex, untilFlow, type FoldFlowSeenRef,
} from './foldToolFlow.fixtures';
import type { FoldStateView } from './useFoldStateView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let session: FoldSession;
let host: HTMLDivElement;
let root: Root;
const cursor = () => selectFoldCursorNode(session.store.getState());

describe.skipIf(!FOLD_FLOW_AVAILABLE)('independent pleat lines', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    session.retain();
    await settle();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); session.dispose(); });

  it('folds both drawn lines unchanged, keeps the layer selection, and saves a replayable pleat', async () => {
    const document = createFoldSequence({ shape: { kind: 'square' }, startSide: 'front' });
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], initialFoldReaderState(document.id));
    await untilFlow(() => cursor().status === 'ok', 'the sheet');
    // A generic three-layer strip, independent of the private Heart model.
    for (const [x, movingX] of [[0.25, 0.1], [0.75, 0.9]] as const) {
      expect(await session.commitStep({
        kind: 'valley', line: { via: 'free', through: [[x, 0], [x, 1]] },
        moving: [movingX, 0.1], seed: { scope: 'all' },
      })).toMatchObject({ status: 'committed' });
      await settle();
    }
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool('pleat'); tools.setFreeLineSnap(false);
    const seen: FoldFlowSeenRef = { current: null };
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    await clickPane(seen, { x: 0.3, y: 0.55 });
    await clickPane(seen, { x: 0.7, y: 0.55 });
    await clickPane(seen, { x: 0.3, y: 0.5006 });
    await clickPane(seen, { x: 0.7, y: 0.4994 });
    await act(async () => { seen.current!.verbs.throughAllLayers(); await settle(); });
    const original = tools.store.getState();
    expect(original.picks).toHaveLength(4);
    expect(useWorkspaceStore.getState().foldSequences[0]!.document.steps).toHaveLength(2);
    const preview = await untilFlow(() => {
      const p = seen.current?.preview;
      return p?.landed && !p.landing && !p.orderResolution?.waiting && p;
    }, 'the angled pleat');
    expect(preview.refused).toBeNull();
    expect(tools.store.getState().picks).toEqual(original.picks);
    expect(preview.orderResolution?.required).toBe(false);
    const committed = await commitPreviewed(session, seen);
    expect(committed.op).toMatchObject({ kind: 'pleat', resolved: expect.any(Array) });
    const saved = useWorkspaceStore.getState().foldSequences[0]!.document;
    expect(saved.steps).toHaveLength(3);
    const reopened = readFoldSequence(JSON.parse(JSON.stringify(saved)))?.document;
    if (!reopened) throw new Error('saved pleat did not reopen');
    useWorkspaceStore.getState().installFoldSequences([{ document: reopened, readOnlyRaw: null }],
      withFoldCursor(initialFoldReaderState(reopened.id), reopened, reopened.steps.at(-1)!.id));
    const fresh = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    try {
      fresh.retain();
      await untilFlow(() => selectFoldCursorNode(fresh.store.getState()).status === 'ok', 'fresh replay');
      expect(selectFoldCursorNode(fresh.store.getState()).fingerprint).toBe(committed.fingerprint);
    } finally { fresh.dispose(); }
  });
  it('changes the active valley to an axiom through the normal verbs and saves its root', async () => {
    const document = createFoldSequence({ shape: { kind: 'square' }, startSide: 'front' });
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], initialFoldReaderState(document.id));
    await untilFlow(() => cursor().status === 'ok', 'the sheet');
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool('pleat'); tools.setFreeLineSnap(false);
    const seen: FoldFlowSeenRef = { current: null };
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    await clickPane(seen, { x: 0.1, y: 0.6 });
    await clickPane(seen, { x: 0.9, y: 0.6 });
    const mountain = tools.store.getState().picks;
    await clickPane(seen, { x: 0.2, y: 0.5 });
    await act(async () => { seen.current!.verbs.selectLineMode('axiom-2'); await settle(); });
    expect(tools.store.getState().picks).toEqual(mountain);
    expect(tools.store.getState().lineMode).toBe('free');
    expect(tools.store.getState().secondLineMode).toBe('axiom-2');
    expect((await clickPane(seen, { x: 0, y: 0 }))?.pick?.kind).toBe('point');
    expect((await clickPane(seen, { x: 0, y: 1 }))?.pick?.kind).toBe('point');
    const preview = await untilFlow(() => {
      const p = seen.current?.preview;
      return p?.landed && !p.landing && !p.orderResolution?.waiting && p;
    }, 'the second axiom pleat');
    expect(preview.refused).toBeNull();
    expect(preview.rootLine).toBe('second');
    const committed = await commitPreviewed(session, seen);
    expect(committed.op).toMatchObject({ kind: 'pleat', line: { via: 'free' },
      second: { via: 'axiom', axiom: 2 }, secondRoot: { n: [0, 1], d: 0.5 } });
  });

  it('cycles the valley axiom roots independently of the completed mountain root', async () => {
    const document = createFoldSequence({ shape: { kind: 'square' }, startSide: 'front' });
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], initialFoldReaderState(document.id));
    await untilFlow(() => cursor().status === 'ok', 'the sheet');
    // Interior references give both angle bisectors real paper on each side.
    for (const [a, b] of [
      [[0.25, 0], [0.25, 1]], [[0, 0.25], [1, 0.25]],
      [[0.75, 0], [0.75, 1]], [[0, 0.75], [1, 0.75]],
    ] as const) {
      expect(await session.commitStep({ kind: 'precrease', direction: 'valley',
        line: { via: 'free', through: [a, b] }, moving: [0.9, 0.9], seed: { scope: 'all' } })).toMatchObject({ status: 'committed' });
      await settle();
    }
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool('pleat'); tools.selectLineMode('axiom-3');
    const seen: FoldFlowSeenRef = { current: null };
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    await clickPane(seen, { x: 0.25, y: 0.4 });
    await clickPane(seen, { x: 0.4, y: 0.25 });
    await untilFlow(() => seen.current?.preview.candidates?.length === 2, 'mountain bisectors');
    await act(async () => { expect(seen.current!.verbs.stepChoice(1)).toBe(true); await settle(); });
    expect(tools.store.getState().root).toBe(1);
    const mountain = seen.current!.preview.pleatLines?.first;
    await act(async () => { seen.current!.verbs.selectLineMode('axiom-3'); await settle(); });
    await clickPane(seen, { x: 0.75, y: 0.6 });
    await clickPane(seen, { x: 0.6, y: 0.75 });
    await untilFlow(() => seen.current?.preview.rootLine === 'second' && seen.current.preview.candidates?.length === 2, 'valley bisectors');
    await act(async () => { expect(seen.current!.verbs.stepChoice(1)).toBe(true); await settle(); });
    expect(tools.store.getState().secondRoot).toBe(1);
    expect(tools.store.getState().root).toBe(1);
    expect(seen.current!.preview.pleatLines?.first).toEqual(mountain);
    // Changing the valley construction discards only its root and references.
    await act(async () => { seen.current!.verbs.selectLineMode('free'); await settle(); });
    expect(tools.store.getState().picks).toHaveLength(2);
    expect(tools.store.getState().secondRoot).toBe(0);
    expect(tools.store.getState().root).toBe(1);
  });

});

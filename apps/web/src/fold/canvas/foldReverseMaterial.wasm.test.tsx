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
import { sheetToScene } from './foldPicking';
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

describe.skipIf(!FOLD_FLOW_AVAILABLE)('reverse-folding buried material through the Fold canvas', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    session.retain();
    await settle();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); session.dispose(); });

  it('selects the buried tip on the CP, leaves the covering flap still, and saves that selection', async () => {
    // A triangle folded in half again: two two-layer flaps share the same
    // outline, but the source at sheet [1,0] belongs only to the lower one.
    const document = createFoldSequence({ shape: { kind: 'square' }, startSide: 'front' });
    document.steps = [
      { id: 'diagonal', parent: null, op: { kind: 'valley', line: { via: 'free', through: [[1, 0], [0, 1]] }, moving: [0, 0], seed: { scope: 'all' } } },
      { id: 'stack', parent: 'diagonal', op: { kind: 'valley', line: { via: 'free', through: [[0.5, 0.5], [1, 1]] }, moving: [0.4, 0.9], seed: { scope: 'all' } } },
    ];
    const parent = document.steps.at(-1)!.id;
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }],
      withFoldCursor(initialFoldReaderState(document.id), document, parent));
    await untilFlow(() => session.store.getState().cursor === parent && cursor().status === 'ok', 'the stack');
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool('inside-reverse'); tools.selectLineMode('axiom-2'); tools.setReverseKind('inside');
    const seen: FoldFlowSeenRef = { current: null };
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    await clickPane(seen, { x: 1, y: 0 }, 'crease-pattern');
    await clickPane(seen, { x: 0.5, y: 0.5 }, 'crease-pattern');
    const ready = () => untilFlow(() => {
      const p = seen.current?.preview;
      return p?.landed && !p.landing && !p.orderResolution?.waiting && p;
    }, 'the buried tip');
    const preview = await ready();
    expect(preview.reverse?.asked?.analysis.tip).toEqual([4, 6]);
    expect(preview.seed).toMatchObject({ scope: 'flaps', flaps: [{ faces: [4, 6] }] });
    expect(preview.reverse?.ways.length).toBe(0);
    expect(preview.orderResolution?.required ?? false).toBe(false);
    expect(preview.refused).toBeNull();
    // The other material lies in exactly the same place on the screen.
    // Its corner stays put while this corner reaches the destination.
    const landed = preview.landed!.scene;
    const still = sheetToScene(index.scene, [0, 1])!;
    const after = sheetToScene(landed, [0, 1])!;
    expect(after.x).toBeCloseTo(still.x, 10); expect(after.y).toBeCloseTo(still.y, 10);
    const moved = sheetToScene(landed, [1, 0])!;
    expect(moved.x).toBeCloseTo(0.5, 10); expect(moved.y).toBeCloseTo(0.5, 10);

    // Flap chips widen from the resolved interior selection, not the top
    // flap. Explicit all/flap selections take precedence over the CP point.
    const other = preview.section!.flaps.findIndex((flap) => !flap.faces.includes(4));
    await act(async () => { seen.current!.verbs.toggleFlap(other); await settle(); });
    expect(tools.store.getState().seed.scope).toBe('all');
    await act(async () => { seen.current!.verbs.toggleFlap(other); await settle(); });
    expect(tools.store.getState().seed).toMatchObject({ scope: 'flaps', flaps: [{ faces: [4, 6] }] });
    await ready();
    await act(async () => { seen.current!.verbs.throughAllLayers(); await settle(); });
    expect(seen.current!.preview.seed).toEqual({ scope: 'all' });
    await act(async () => { tools.setSeed({ scope: 'top' }); await settle(); });
    await ready();

    const committed = await commitPreviewed(session, seen);
    expect(committed.op).toMatchObject({ kind: 'inside-reverse', seed: { scope: 'flaps' } });
    const saved = useWorkspaceStore.getState().foldSequences[0]!.document;
    expect(saved.steps).toHaveLength(3);
    expect(JSON.stringify(saved.steps.at(-1))).not.toContain('"pane"');
    const reopened = readFoldSequence(JSON.parse(JSON.stringify(saved)))?.document;
    if (!reopened) throw new Error('saved sequence did not reopen');
    useWorkspaceStore.getState().installFoldSequences([{ document: reopened, readOnlyRaw: null }],
      withFoldCursor(initialFoldReaderState(reopened.id), reopened, reopened.steps.at(-1)!.id));
    const fresh = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    try {
      fresh.retain();
      await untilFlow(() => selectFoldCursorNode(fresh.store.getState()).status === 'ok', 'fresh replay');
      expect(selectFoldCursorNode(fresh.store.getState()).fingerprint).toBe(committed.fingerprint);
    } finally { fresh.dispose(); }
  });
});

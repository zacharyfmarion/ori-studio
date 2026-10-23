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

describe.skipIf(!FOLD_FLOW_AVAILABLE)('optional snapping for a free fold line', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    session.retain();
    await settle();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); session.dispose(); });

  it('uses an exact reference at one end and a raw endpoint at the other, then replays the saved fold', async () => {
    const document = createFoldSequence({ shape: { kind: 'square' }, startSide: 'front' });
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }],
      initialFoldReaderState(document.id));
    await untilFlow(() => cursor().status === 'ok', 'the sheet');
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool('precrease'); tools.selectLineMode('free');
    const seen: FoldFlowSeenRef = { current: null };
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    await clickPane(seen, { x: 0.005, y: 0.503 }, 'crease-pattern');
    expect(tools.store.getState().picks[0]).toMatchObject({ kind: 'free', sheet: [0, 0.5] });
    await clickPane(seen, { x: 0.84, y: 0.37 }, 'crease-pattern');
    expect(tools.store.getState().picks[1]).toMatchObject({ kind: 'free', sheet: [0.84, 0.37] });
    const preview = await untilFlow(() => {
      const p = seen.current?.preview;
      return p?.landed && !p.landing && !p.orderResolution?.waiting && p;
    }, 'the mixed endpoint precrease');
    if (preview.build.status !== 'built') throw new Error('no free line');
    const { n, d } = preview.build.sceneLine;
    expect(n[1] * 0.5 - d).toBeCloseTo(0, 12);
    expect(n[0] * 0.84 + n[1] * 0.37 - d).toBeCloseTo(0, 12);
    await act(async () => { seen.current!.verbs.setFreeLineSnap(false); await settle(); });
    // Toggling while previewing never moves already placed endpoints.
    expect(seen.current!.preview.build).toEqual(preview.build);
    expect(preview.orderResolution?.required ?? false).toBe(false);
    expect(preview.refused).toBeNull();
    const committed = await commitPreviewed(session, seen);
    expect(committed.op).toMatchObject({ kind: 'precrease', line: { via: 'free' } });
    const saved = useWorkspaceStore.getState().foldSequences[0]!.document;
    expect(saved.steps).toHaveLength(1);
    expect(tools.store.getState().freeLineSnap).toBe(false);
    // Save/read into a new runtime: fingerprints include every paper side,
    // crease assignment and layer relation, as well as the silhouette.
    const reopened = readFoldSequence(JSON.parse(JSON.stringify(saved)))?.document;
    if (!reopened) throw new Error('saved free-line sequence did not reopen');
    useWorkspaceStore.getState().installFoldSequences([{ document: reopened, readOnlyRaw: null }],
      withFoldCursor(initialFoldReaderState(reopened.id), reopened, reopened.steps[0]!.id));
    const fresh = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    try {
      fresh.retain();
      await untilFlow(() => selectFoldCursorNode(fresh.store.getState()).status === 'ok', 'fresh replay');
      expect(selectFoldCursorNode(fresh.store.getState()).fingerprint).toBe(committed.fingerprint);
    } finally { fresh.dispose(); }
  });
});

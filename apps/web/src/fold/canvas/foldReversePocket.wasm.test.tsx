import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { createFoldSequence, type FoldStep, type SheetPoint } from '../document/foldSequenceDocument';
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

describe.skipIf(!FOLD_FLOW_AVAILABLE)('a connected reverse-fold pocket through the Fold tools', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    session.retain();
    await settle();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); session.dispose(); });

  it('reverses both sides by bringing the roof tip onto the waist, without an opening chooser', async () => {
    const document = createFoldSequence({ shape: { kind: 'square' }, startSide: 'front' });
    const steps: FoldStep[] = [];
    for (const x of [0, 1]) {
      steps.push({ id: `corner-${x}`, parent: steps.at(-1)?.id ?? null,
        op: { kind: 'valley', line: { via: 'free', through: [[0.5, 1], [x, 0.5]] }, moving: [x, 1], seed: { scope: 'all' } } });
    }
    document.steps = steps;
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }],
      withFoldCursor(initialFoldReaderState(document.id), document, 'corner-1'));
    await untilFlow(() => session.store.getState().cursor === 'corner-1' && cursor().status === 'ok', 'the pocket');
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool('inside-reverse'); tools.selectLineMode('axiom-2');
    const seen: FoldFlowSeenRef = { current: null };
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    for (const point of [[0.5, 1], [0.5, 0.5]] as SheetPoint[]) {
      const at = sheetToScene(index.scene, point);
      if (!at) throw new Error('missing pocket point');
      await clickPane(seen, at);
    }
    const preview = await untilFlow(() => {
      const p = seen.current?.preview;
      return p?.landed && !p.landing && !p.orderResolution?.waiting && p;
    }, 'the complete pocket');
    expect(preview.reverse?.ways.length).toBe(0);
    expect(preview.orderResolution?.required ?? false).toBe(false);
    expect(preview.refused).toBeNull();
    const committed = await commitPreviewed(session, seen);
    expect(committed.op.kind).toBe('inside-reverse');
    const saved = useWorkspaceStore.getState().foldSequences[0]!.document;
    expect(saved.steps).toHaveLength(3);
    expect(saved.steps[2]).not.toHaveProperty('choices.opening');
    // Save/read into a new runtime: fingerprints include every paper side,
    // crease assignment and layer relation, as well as the silhouette.
    const reopened = readFoldSequence(JSON.parse(JSON.stringify(saved)))?.document;
    if (!reopened) throw new Error('saved pocket sequence did not reopen');
    useWorkspaceStore.getState().installFoldSequences([{ document: reopened, readOnlyRaw: null }],
      withFoldCursor(initialFoldReaderState(reopened.id), reopened, reopened.steps[2]!.id));
    const fresh = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    try {
      fresh.retain();
      await untilFlow(() => selectFoldCursorNode(fresh.store.getState()).status === 'ok', 'fresh replay');
      expect(selectFoldCursorNode(fresh.store.getState()).fingerprint).toBe(committed.fingerprint);
    } finally { fresh.dispose(); }
  });
});

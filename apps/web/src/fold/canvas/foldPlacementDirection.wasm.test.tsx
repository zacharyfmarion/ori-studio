import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { createFoldSequence, type FoldStep, type SheetPoint } from '../document/foldSequenceDocument';
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

describe.skipIf(!FOLD_FLOW_AVAILABLE)('direction-preserving placement through the Fold tools', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    session.retain();
    await settle();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); session.dispose(); });

  it.each(['valley', 'mountain'] as const)('commits the unique %s corner fold without a layer-order prompt', async (direction) => {
    const document = createFoldSequence({ shape: { kind: 'square' }, startSide: 'front' });
    const steps: FoldStep[] = [];
    for (const c of [0.5, 0.25, 0.75]) {
      const lines: [SheetPoint, SheetPoint][] = [[[c, 0], [c, 1]], [[0, c], [1, c]]];
      for (const through of lines) {
        steps.push({ id: `grid-${steps.length}`, parent: steps.at(-1)?.id ?? null,
          op: { kind: 'precrease', line: { via: 'free', through }, direction: 'valley', moving: [0.9, 0.9], seed: { scope: 'all' } } });
      }
    }
    steps.push({ id: 'turn', parent: steps.at(-1)!.id, op: { kind: 'turn', axis: 'vertical' } });
    document.steps = steps;
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }],
      withFoldCursor(initialFoldReaderState(document.id), document, 'turn'));
    await untilFlow(() => session.store.getState().cursor === 'turn' && cursor().status === 'ok', 'the grid');
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool(direction); tools.selectLineMode('axiom-2');
    const seen: FoldFlowSeenRef = { current: null };
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    for (const point of [[0, 1], [0.5, 0.5]] as SheetPoint[]) {
      const at = sheetToScene(index.scene, point);
      if (!at) throw new Error('missing grid point');
      await clickPane(seen, at);
    }
    const preview = await untilFlow(() => {
      const p = seen.current?.preview;
      return p?.landed && !p.landing && !p.orderResolution?.waiting && p;
    }, 'the unique corner fold');
    expect(preview.orderResolution).toMatchObject({ count: 1, exact: true, required: false, active: false });
    const committed = await commitPreviewed(session, seen);
    expect(committed.op).toMatchObject({ kind: direction, landing: { kind: 'outer' } });
    expect(document.steps).toHaveLength(7);
    expect(useWorkspaceStore.getState().foldSequences[0]!.document.steps).toHaveLength(8);
  });
});

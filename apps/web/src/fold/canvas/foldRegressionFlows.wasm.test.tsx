import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { isLockedStep, type FoldSequenceDocument, type FoldStep, type SheetPoint } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import { foldRefusalNotice } from '../tools/refusalNotice';
import { createFoldTools, type FoldTools } from '../tools/foldToolState';
import { foldWindowPreview } from './foldCanvasModel';
import { sheetToScene, type FoldPickIndex } from './foldPicking';
import {
  clickPane,
  commitPreviewed,
  FOLD_FLOW_AVAILABLE,
  foldFlowBridge,
  FoldFlowCanvas,
  shownPickIndex,
  untilFlow,
  type FoldFlowSeenRef,
} from './foldToolFlow.fixtures';
import type { FoldStateView } from './useFoldStateView';

/**
 * The ghost precrease (`tests/fixtures/fold-regressions/ghost-precrease.osf`)
 * made through the tools, as a folder makes it: the flap's corner lies on
 * the strip's corner, which shows past it. Clicked on the folded pane, the
 * corner takes the flap's sheet point — the one a click on the crease
 * pattern takes — and the precrease lands as the fixture stores it. Picked
 * on the crease pattern at the strip's corner instead, it is refused as the
 * point staying put, and the refusal offers the point on the moving flap,
 * which lands it.
 *
 * Skipped when the bridge has not been built.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = resolve(process.cwd(), '../../tests/fixtures/fold-regressions/ghost-precrease.osf');
const t = i18n.t.bind(i18n);

let session: FoldSession;
let host: HTMLDivElement;
let root: Root;

const snapshot = () => session.store.getState();
const cursor = () => selectFoldCursorNode(snapshot());

function opened(): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(FIXTURE, 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error('no sequence');
  return held.document;
}

function stepAt(document: FoldSequenceDocument, n: number): FoldStep {
  const node = document.steps[n];
  if (!node || isLockedStep(node)) throw new Error(`step ${n + 1} is missing or locked`);
  return node;
}

describe.skipIf(!FOLD_FLOW_AVAILABLE || !existsSync(FIXTURE))('the ghost precrease through the tools', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    session.retain();
    await settle();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    session.dispose();
  });

  it('takes the flap’s corner on the folded pane, and offers it when the strip’s corner is picked', async () => {
    const fixture = opened();
    const precrease = stepAt(fixture, 3);
    // The fixture to its third step, on screen: the flap's corner on the strip's.
    const document = { ...fixture, steps: fixture.steps.slice(0, 3) };
    const parent = stepAt(document, 2);
    useWorkspaceStore
      .getState()
      .installFoldSequences([{ document, readOnlyRaw: null }], withFoldCursor(initialFoldReaderState(document.id), document, parent.id));
    await untilFlow(() => snapshot().cursor === parent.id && cursor().status === 'ok' && cursor().summary, 'the flap on the strip');
    const tools: FoldTools = createFoldTools();
    const seen: FoldFlowSeenRef = { current: null };
    const index: FoldPickIndex = await shownPickIndex(session);
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    const verbs = () => {
      const now = seen.current?.verbs;
      if (!now) throw new Error('no canvas');
      return now;
    };
    const shown = (sheet: SheetPoint) => {
      const at = sheetToScene(index.scene, sheet);
      if (!at) throw new Error('not on the paper');
      return at;
    };
    const P: SheetPoint = [1, 0.5];
    const Q: SheetPoint = [0.5, 0.25];
    const landed = () =>
      untilFlow(() => {
        const preview = seen.current?.preview;
        return preview?.step && !preview.landing && !preview.refused ? preview.step : null;
      }, 'the precrease');
    const picked = () => tools.store.getState().picks.map((pick) => (pick.kind === 'point' ? pick.sheet : null));

    await act(async () => {
      verbs().selectTool('precrease');
      verbs().selectLineMode('axiom-2');
      await settle();
    });

    // On the folded pane: P and Q where it draws them, then on the crease pattern.
    await clickPane(seen, shown(P));
    await clickPane(seen, shown(Q));
    expect(picked()).toEqual([P, Q]);
    const folded = await landed();
    await act(async () => {
      verbs().cancel();
      await settle();
    });
    await clickPane(seen, { x: P[0], y: P[1] }, 'crease-pattern');
    await clickPane(seen, { x: Q[0], y: Q[1] }, 'crease-pattern');
    expect(picked()).toEqual([P, Q]);
    const onPattern = await landed();
    expect(folded.op).toEqual(onPattern.op);
    expect(folded.op).toMatchObject({ kind: 'precrease', line: precrease.op.kind === 'precrease' ? precrease.op.line : null });

    // The strip's corner, picked on the crease pattern at the same spot: refused, the point staying put.
    await act(async () => {
      verbs().cancel();
      await settle();
    });
    const under: SheetPoint = [0, 1];
    await clickPane(seen, { x: under[0], y: under[1] }, 'crease-pattern');
    await clickPane(seen, shown(Q));
    expect(picked()).toEqual([under, Q]);
    const offered = await untilFlow(() => {
      const preview = seen.current?.preview;
      return preview?.refused?.refusal.code === 'mover_stays' && preview.moverFix ? preview : null;
    }, 'the refusal and its fix');
    expect(offered.moverFix).toMatchObject({ from: under, to: P });
    const window = foldWindowPreview(tools.store.getState(), offered);
    expect(window?.movingPoint).toBe(true);
    const notice = foldRefusalNotice(
      t,
      offered.refused!,
      { kind: 'precrease', readOnly: false, flapNumber: (flap) => flap + 1, flapOf: null, movingPoint: window?.movingPoint === true },
      verbs()
    );
    const fix = notice.actions.find((action) => action.id === 'moving-point');
    expect(fix?.label).toBe('Use the point on the moving flap');
    await act(async () => {
      fix?.run();
      await settle();
    });
    expect(picked()).toEqual([P, Q]);
    const fixed = await landed();
    expect(fixed.op).toEqual(folded.op);
    // Committed, it is the fixture's step.
    const committed = await commitPreviewed(session, seen);
    expect(committed.fingerprint).toBe(precrease.expect);
  });
});

import { readFileSync } from 'node:fs';
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
import { foldStackAt, sheetToScene, type FoldPickIndex } from './foldPicking';
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

/** Recreate the final step of saved Fold regressions through the canvas hit tests, preview and commit. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = resolve(process.cwd(), '../../tests/fixtures/fold-regressions');
const t = i18n.t.bind(i18n);

let session: FoldSession;
let host: HTMLDivElement;
let root: Root;

const snapshot = () => session.store.getState();
const cursor = () => selectFoldCursorNode(snapshot());

function opened(name: string): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(resolve(FIXTURES, name), 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error('no sequence');
  return held.document;
}

function stepAt(document: FoldSequenceDocument, n: number): FoldStep {
  const node = document.steps[n];
  if (!node || isLockedStep(node)) throw new Error(`step ${n + 1} is missing or locked`);
  return node;
}

describe.skipIf(!FOLD_FLOW_AVAILABLE)('Fold regression fixtures through the canvas tools', () => {
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

  async function beforeLastStep(name: string) {
    const fixture = opened(name);
    const last = stepAt(fixture, fixture.steps.length - 1);
    const document = { ...fixture, steps: fixture.steps.slice(0, -1) };
    const parent = stepAt(document, document.steps.length - 1);
    useWorkspaceStore
      .getState()
      .installFoldSequences([{ document, readOnlyRaw: null }], withFoldCursor(initialFoldReaderState(document.id), document, parent.id));
    await untilFlow(() => snapshot().cursor === parent.id && cursor().status === 'ok' && cursor().summary, name);
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
    return { last, tools, index, seen, verbs };
  }

  it('takes the flap’s corner on the folded pane, and offers it when the strip’s corner is picked', async () => {
    const { last: precrease, tools, index, seen, verbs } = await beforeLastStep('ghost-precrease.osf');
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

  it('rabbit-ears the top layer of the corner with the backing and the sheet body still', async () => {
    const { last, tools, index: before, seen, verbs } = await beforeLastStep('rabbit-ear-folded-corner.osf');
    const [flap, backing] = foldStackAt(before, { x: 0.75, y: 0.32 });
    if (flap === undefined || backing === undefined) throw new Error('expected the corner folded over its backing');
    await act(async () => {
      verbs().selectTool('rabbit-ear');
      await settle();
    });
    for (const [x, y] of [[0.5, 0.5], [1, 0.5], [0.5, 0], [0.72, 0.47]] as const) {
      await clickPane(seen, { x, y });
    }
    await act(async () => {
      tools.setFanLayers(1);
      await settle();
    });
    await untilFlow(() => {
      const preview = seen.current?.preview;
      return preview?.step && !preview.landing && !preview.refused;
    }, 'the single-layer rabbit ear');
    const committed = await commitPreviewed(session, seen);
    expect(committed.fingerprint).toBe(last.expect);

    const after = await shownPickIndex(session);
    for (const [i, face] of before.scene.lineage.entries()) {
      if (i === flap) continue;
      const j = after.scene.lineage.findIndex(child => child.id === face.id);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(after.scene.face_transforms[j]).toEqual(before.scene.face_transforms[i]);
      expect(after.scene.faces[j]!.front_up).toBe(before.scene.faces[i]!.front_up);
    }
    const stack = foldStackAt(after, { x: 0.75, y: 0.32 }).map(i => after.scene.lineage[i]!);
    expect(stack).toHaveLength(5);
    expect(stack[4]!.id).toBe(before.scene.lineage[backing]!.id);
    for (const piece of stack.slice(0, 4)) expect(piece.parent).toBe(before.scene.lineage[flap]!.id);
  });
});

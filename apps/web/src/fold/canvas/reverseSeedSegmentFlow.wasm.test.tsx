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
import { isLockedStep, type FoldSequenceDocument, type FoldStep } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import { foldRefusalNotice, sectionFlapNames } from '../tools/refusalNotice';
import { createFoldTools, type FoldTools } from '../tools/foldToolState';
import { clearHeldModifiers, syncHeldModifiersFromEvent } from '../../keyboard/heldModifiers';
import { foldWindowPreview } from './foldCanvasModel';
import type { FoldPickIndex } from './foldPicking';
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
import type { FoldToolPreview } from './useFoldToolPreview';
import type { FoldStateView } from './useFoldStateView';

/**
 * The reverse fold of `tests/fixtures/fold-regressions/reverse-seed-segment.osf`
 * made through the tools: a line drawn across the L's left arm only, whose
 * extension crosses the up arm's end too. Drawn as a free line or by Axiom 1,
 * its default seed is the flap the stretch drawn crosses, and it lands as the
 * fixture stores it; with every layer on the line it is refused, and the
 * refusal offers that flap alone, which lands it.
 *
 * Skipped when the bridge has not been built.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = resolve(process.cwd(), '../../tests/fixtures/fold-regressions/reverse-seed-segment.osf');
const t = i18n.t.bind(i18n);

/** The stretch drawn across the left arm, in the model frame: on the fixture's line, clear of both its edges. */
const ENDS = [
  { x: 0.12, y: 0.018 },
  { x: 0.22, y: 0.108 },
];

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

describe.skipIf(!FOLD_FLOW_AVAILABLE || !existsSync(FIXTURE))('a reverse fold drawn across one of two flaps on its line', () => {
  let reverse: FoldStep;
  let tools: FoldTools;
  let seen: FoldFlowSeenRef;
  let index: FoldPickIndex;

  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await foldFlowBridge() });
    session.retain();
    await settle();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    // The fixture to its second step, on screen: the L, before the reverse fold.
    const fixture = opened();
    reverse = stepAt(fixture, 2);
    const document_ = { ...fixture, steps: fixture.steps.slice(0, 2) };
    const parent = stepAt(document_, 1);
    useWorkspaceStore
      .getState()
      .installFoldSequences([{ document: document_, readOnlyRaw: null }], withFoldCursor(initialFoldReaderState(document_.id), document_, parent.id));
    await untilFlow(() => snapshot().cursor === parent.id && cursor().status === 'ok' && cursor().summary, 'the L');
    tools = createFoldTools();
    seen = { current: null };
    index = await shownPickIndex(session);
    await act(async () => {
      root.render(<FoldFlowCanvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
  });

  afterEach(() => {
    clearHeldModifiers();
    act(() => root.unmount());
    host.remove();
    session.dispose();
  });

  const verbs = () => {
    const now = seen.current?.verbs;
    if (!now) throw new Error('no canvas');
    return now;
  };
  const landed = () =>
    untilFlow(() => {
      const preview = seen.current?.preview;
      return preview?.step && !preview.landing && !preview.refused ? preview : null;
    }, 'the reverse fold');
  const draw = async (lineMode: 'free' | 'axiom-1') => {
    await act(async () => {
      verbs().selectTool('inside-reverse');
      verbs().selectLineMode(lineMode);
      await settle();
    });
    for (const end of ENDS) await clickPane(seen, index.toScene(end));
  };
  /** The flaps the preview's seed names, as the window's chips press them; and how many the section lists. */
  const chips = (preview: FoldToolPreview) => {
    const window = foldWindowPreview(tools.store.getState(), preview);
    return { pressed: window?.seed, of: preview.section?.flaps.length };
  };

  it('seeds a free line with the flap it is drawn across, and lands as the fixture stores it', async () => {
    await draw('free');
    const preview = await landed();
    expect(chips(preview)).toEqual({ pressed: [expect.any(Number)], of: 2 });
    expect(preview.step?.op).toEqual(reverse.op);
    const committed = await commitPreviewed(session, seen);
    expect(committed.fingerprint).toBe(reverse.expect);
  });

  it('seeds an Axiom 1 line through two points of the arm with that arm alone', async () => {
    // Alt held: the two points are anywhere on the arm, not snapped to a landmark.
    syncHeldModifiersFromEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false });
    await draw('axiom-1');
    expect(tools.store.getState().picks.map((pick) => pick.kind)).toEqual(['point', 'point']);
    const preview = await landed();
    expect(chips(preview)).toEqual({ pressed: [expect.any(Number)], of: 2 });
    expect(preview.step?.op).toMatchObject({ kind: 'inside-reverse', line: { via: 'axiom', axiom: 1 }, seed: reverse.op.kind === 'inside-reverse' ? reverse.op.seed : null });
  });

  it('offers the drawn flap alone when every layer on the line is refused', async () => {
    await draw('free');
    const drawn = await landed();
    const [flap] = chips(drawn).pressed as number[];
    await act(async () => {
      verbs().throughAllLayers();
      await settle();
    });
    const offered = await untilFlow(() => {
      const preview = seen.current?.preview;
      return preview?.refused?.refusal.code === 'reverse_kind_infeasible' && preview.seedFix ? preview : null;
    }, 'the refusal and its fix');
    expect(chips(offered).pressed).toBe('all');
    const window = foldWindowPreview(tools.store.getState(), offered);
    expect(window?.narrowerSeed).toEqual([flap]);
    const names = sectionFlapNames(offered.section);
    const notice = foldRefusalNotice(
      t,
      offered.refused!,
      { kind: 'reverse', readOnly: false, ...names, narrowerSeed: window?.narrowerSeed ?? [] },
      verbs()
    );
    const fix = notice.actions.find((action) => action.id === 'narrower-seed');
    expect(fix?.label).toBe(`Reverse flap ${names.flapNumber(flap!)} only`);
    await act(async () => {
      fix?.run();
      await settle();
    });
    const fixed = await landed();
    expect(fixed.step?.op).toEqual(reverse.op);
  });
});

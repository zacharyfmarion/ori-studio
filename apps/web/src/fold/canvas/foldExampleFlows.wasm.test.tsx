import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import type { FoldOp, FoldRef, FoldSequenceDocument, FoldStep, SheetPoint } from '../document/foldSequenceDocument';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import type { FoldLineModeId, FoldToolId } from '../tools/foldToolCatalog';
import { layersSection, type FoldToolWindowVerbs } from '../tools/foldToolWindow';
import { createFoldTools, type FoldTools } from '../tools/foldToolState';
import { foldWindowPreview } from './foldCanvasModel';
import { sheetToScene, type FoldPickIndex } from './foldPicking';
import {
  clickPane,
  commitPreviewed,
  exampleStep,
  FOLD_FLOW_AVAILABLE,
  foldFlowBridge,
  FoldFlowCanvas,
  openedExample,
  shownPickIndex,
  untilFlow,
  type FoldFlowSeenRef,
} from './foldToolFlow.fixtures';
import type { FoldStateView } from './useFoldStateView';

/**
 * The example projects' first steps made fresh through the tools, with every
 * fold along a line taking the top flap by default (owner request,
 * 2026-10-13): from the flat sheet, each step's clicks as the README in
 * `tests/fixtures/fold-examples` gives them — on the folded pane, through
 * the canvas's hit test and pick (`useFoldCanvasVerbs`), the preview
 * (`useFoldToolPreview`, the section at the line and the seed resolved
 * against it, `useFoldLineSection`) and the commit — each committed step's
 * state to the fingerprint the example stores.
 *
 * The clicks are where the README's are: on the stored step's own sheet
 * references, as the folded pane shows them, so each lands on the corner,
 * edge or flap the README names. Nothing chosen in the window that the
 * README does not choose: the kite creases of the petal fold take only the
 * top flap now with no chip pressed, where the README had Flap 2 left out.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t.bind(i18n);

let session: FoldSession;
let host: HTMLDivElement;
let root: Root;

const snapshot = () => session.store.getState();
const cursor = () => selectFoldCursorNode(snapshot());

/** A flow through one example: its stored steps, the tools, and the canvas mounted over the step on screen. */
interface Flow {
  example: FoldSequenceDocument;
  tools: FoldTools;
  seen: FoldFlowSeenRef;
  index: FoldPickIndex;
}

/** The canvas over the step on screen, indexed afresh. */
async function remount(flow: Omit<Flow, 'index'> & { index?: FoldPickIndex }): Promise<Flow> {
  const index = await shownPickIndex(session);
  await act(async () => {
    root.render(<FoldFlowCanvas session={session} tools={flow.tools} view={{ index } as FoldStateView} seenRef={flow.seen} />);
    await settle();
  });
  return { ...flow, index };
}

/** The example's flat sheet on screen, nothing folded yet, and the tools fresh. */
async function sheetOf(name: string): Promise<Flow> {
  const example = openedExample(name);
  const document = { ...example, steps: [] };
  useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], initialFoldReaderState(document.id));
  await untilFlow(() => snapshot().cursor === null && cursor().status === 'ok' && cursor().summary, 'the sheet');
  return remount({ example, tools: createFoldTools(), seen: { current: null } });
}

function verbsOf(flow: Flow) {
  const verbs = flow.seen.current?.verbs;
  if (!verbs) throw new Error('no canvas');
  return verbs;
}

/** A tool taken in hand from the rail, and its line mode. */
async function take(flow: Flow, tool: FoldToolId, lineMode?: FoldLineModeId) {
  await act(async () => {
    verbsOf(flow).selectTool(tool);
    if (lineMode) verbsOf(flow).selectLineMode(lineMode);
    await settle();
  });
}

/** Where a sheet point lies on the folded pane. */
function shown(flow: Flow, sheet: SheetPoint): { x: number; y: number } {
  const at = sheetToScene(flow.index.scene, sheet);
  if (!at) throw new Error(`${sheet.join(', ')} is not on the paper`);
  return at;
}

/** A click on an axiom's reference where the folded pane shows it: a point, or a point along an edge or crease. */
async function clickRef(flow: Flow, ref: FoldRef) {
  if (ref.kind === 'edge') {
    const [a, b] = [shown(flow, ref.a), shown(flow, ref.b)];
    // Off the middle, where a crossing or a midpoint could be nearer than the line.
    const hit = await clickPane(flow.seen, { x: a.x + 0.4 * (b.x - a.x), y: a.y + 0.4 * (b.y - a.y) });
    expect(hit?.pick?.kind).toBe('segment');
    return;
  }
  const hit = await clickPane(flow.seen, shown(flow, ref.at));
  expect(hit?.pick).toMatchObject({ kind: 'point' });
}

/** The stored step's axiom references, clicked in the order it stores them. */
async function clickAxiom(flow: Flow, stored: FoldStep) {
  const op = stored.op;
  if (!('line' in op) || op.line.via !== 'axiom') throw new Error('not along an axiom line');
  for (const ref of op.line.inputs) await clickRef(flow, ref);
}

/** The step the tools preview once it has landed; what the tools hold and the preview says, when it never does. */
async function landedStep(flow: Flow) {
  try {
    return await untilFlow(() => {
      const preview = flow.seen.current?.preview;
      return preview?.step && !preview.landing && !preview.refused ? preview.step : null;
    }, 'the preview');
  } catch (error) {
    const { tool, lineMode, picks, seed } = flow.tools.store.getState();
    const preview = flow.seen.current?.preview;
    const said = {
      tool,
      lineMode,
      picks: picks.map((pick) => pick.kind),
      seed: seed.scope,
      resolved: preview?.seed?.scope ?? null,
      build: preview?.build.status,
      candidates: preview?.candidates?.length ?? null,
      refused: preview?.refused?.refusal.code ?? null,
      landing: preview?.landing,
      step: preview?.step?.op.kind ?? null,
      choices: preview?.step?.choices ?? null,
      analysis: snapshot().analysis.status,
      pending: snapshot().pending.status,
    };
    throw new Error(`${String(error)}: ${JSON.stringify(said)}`, { cause: error });
  }
}

/**
 * The step previewed, committed as Enter commits it: the op previewed is the
 * op stored, and the state it lands is the example's.
 */
async function commitAs(flow: Flow, stored: FoldStep): Promise<{ flow: Flow; op: FoldOp }> {
  const previewed = await landedStep(flow);
  const committed = await commitPreviewed(session, flow.seen);
  expect(committed.op).toEqual(previewed.op);
  expect(committed.fingerprint, `step ${flow.example.steps.indexOf(stored) + 1}`).toBe(stored.expect);
  return { flow: await remount(flow), op: committed.op };
}

/** The window's Layers, as the tool window shows them for the step previewed. */
function layersShown(flow: Flow) {
  const preview = flow.seen.current?.preview;
  if (!preview) throw new Error('no preview');
  const window = foldWindowPreview(flow.tools.store.getState(), preview);
  if (!window) throw new Error('nothing located');
  return layersSection(t, window, {} as FoldToolWindowVerbs, false);
}

/** The axiom root the tools took: the stored step's, the first the engine lists. */
function expectStoredRoot(flow: Flow, stored: FoldStep) {
  const root = stored.choices?.root;
  const taken = flow.seen.current?.preview.step?.choices?.root;
  if (!root || !taken) throw new Error('no root');
  expect(taken.n[0]).toBeCloseTo(root.n[0], 9);
  expect(taken.n[1]).toBeCloseTo(root.n[1], 9);
  expect(taken.d).toBeCloseTo(root.d, 9);
}

describe.skipIf(!FOLD_FLOW_AVAILABLE)('the fold examples made fresh through the tools, the top flap by default', () => {
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

  it('makes swivel-on-edge.osf to its squash, steps 1–6, each to its stored fingerprint', async () => {
    let flow = await sheetOf('swivel-on-edge.osf');
    const step = (n: number) => exampleStep(flow.example, n - 1);

    // 1. Valley fold, Axiom 2: the bottom-left corner, then the top-right.
    // The axiom moves the first point; the example folds the top-right half
    // down, so Swap. Either half is one flap: every layer.
    await take(flow, 'valley', 'axiom-2');
    await clickAxiom(flow, step(1));
    await landedStep(flow);
    let swapped = false;
    await act(async () => {
      swapped = verbsOf(flow).swapSide();
      await settle();
    });
    expect(swapped).toBe(true);
    await landedStep(flow);
    expectStoredRoot(flow, step(1));
    expect(flow.seen.current?.preview.seed).toEqual({ scope: 'all' });
    ({ flow } = await commitAs(flow, step(1)));

    // 2. Precrease, Axiom 2: the bottom-right corner onto the top-left. The
    // triangle's half is one flap, its two layers joined by the fold: every layer.
    await take(flow, 'precrease', 'axiom-2');
    await clickAxiom(flow, step(2));
    await landedStep(flow);
    expectStoredRoot(flow, step(2));
    expect(flow.seen.current?.preview.seed).toEqual({ scope: 'all' });
    expect(layersShown(flow).chips.every((chip) => chip.pressed)).toBe(true);
    ({ flow } = await commitAs(flow, step(2)));

    // 3–4. Inside reverse folds, Axiom 2: a reverse fold takes its whole point, every layer.
    for (const n of [3, 4]) {
      await take(flow, 'inside-reverse', 'axiom-2');
      await clickAxiom(flow, step(n));
      await landedStep(flow);
      expectStoredRoot(flow, step(n));
      expect(flow.seen.current?.preview.seed).toEqual({ scope: 'all' });
      ({ flow } = await commitAs(flow, step(n)));
    }

    // 5. Rotate ⅛ of a turn counterclockwise.
    await take(flow, 'rotate');
    await act(async () => {
      flow.tools.setRotation({ amount: 'eighth', direction: 'ccw' });
      await settle();
    });
    ({ flow } = await commitAs(flow, step(5)));

    // 6. Squash the front flap on the right.
    const squash = step(6).op;
    if (squash.kind !== 'squash') throw new Error('step 6 is the squash');
    await take(flow, 'squash');
    await clickPane(flow.seen, shown(flow, squash.flap));
    await commitAs(flow, step(6));
  });

  it('folds the preliminary base’s top flap by default, every layer once the other chips are pressed, and the top flap again after Escape', async () => {
    // swivel-on-edge.osf to its fourth step: the preliminary base, its four loose corners at the origin.
    const example = openedExample('swivel-on-edge.osf');
    const document = { ...example, steps: example.steps.slice(0, 4) };
    const base = exampleStep(document, 3);
    useWorkspaceStore
      .getState()
      .installFoldSequences([{ document, readOnlyRaw: null }], withFoldCursor(initialFoldReaderState(document.id), document, base.id));
    await untilFlow(() => snapshot().cursor === base.id && cursor().status === 'ok' && cursor().summary, 'the preliminary base');
    const flow = await remount({ example: document, tools: createFoldTools(), seen: { current: null } });

    // A valley along a free line across the loose corners, x + y = 0.43.
    await take(flow, 'valley', 'free');
    await clickPane(flow.seen, { x: 0.35, y: 0.079 });
    await clickPane(flow.seen, { x: 0.079, y: 0.35 });
    const top = await landedStep(flow);
    expect(flow.tools.store.getState().seed).toEqual({ scope: 'top' });
    expect(top.op).toMatchObject({ kind: 'valley', seed: { scope: 'flaps' } });
    const analysed = () =>
      untilFlow(() => {
        const preview = flow.seen.current?.preview;
        return preview?.analysis && preview.step && !preview.landing ? preview : null;
      }, 'the analysis');
    const narrow = await analysed();
    const layers = layersShown(flow);
    // Four flaps at the line, the top one alone pressed and alone moving.
    expect(layers.chips.map((chip) => chip.pressed)).toEqual([true, false, false, false]);
    const topRows = layers.picker?.rows.filter((row) => row.state === 'picked').length ?? 0;
    expect(layers.picker?.rows.filter((row) => row.state === 'excluded').length).toBe((layers.picker?.rows.length ?? 0) - topRows);
    expect(layers.summary).toBe(`${topRows} of ${layers.picker?.rows.length} layers moving`);
    expect(narrow.analysis?.added).toEqual([]);
    const fewer = narrow.analysis?.moving.length ?? 0;

    // Every other chip pressed: every layer, previewed and analysed as such.
    for (const chip of layers.chips.filter((each) => !each.pressed)) {
      await act(async () => {
        verbsOf(flow).toggleFlap(chip.flap);
        await settle();
      });
    }
    expect(flow.tools.store.getState().seed).toEqual({ scope: 'all' });
    const wide = await untilFlow(() => {
      const preview = flow.seen.current?.preview;
      return preview?.step?.op.kind === 'valley' && 'seed' in preview.step.op && preview.step.op.seed.scope === 'all' && preview.analysis
        ? preview
        : null;
    }, 'every layer');
    expect(layersShown(flow).chips.every((chip) => chip.pressed)).toBe(true);
    expect(layersShown(flow).summary).toBe(`${layers.picker?.rows.length} of ${layers.picker?.rows.length} layers moving`);
    expect(wide.analysis?.moving.length).toBeGreaterThan(fewer);

    // Escape lets the picks go and the seed with them: the next line starts on its top flap again.
    await act(async () => {
      verbsOf(flow).cancel();
      await settle();
    });
    expect(flow.tools.store.getState()).toMatchObject({ picks: [], seed: { scope: 'top' } });
  });

  it('makes petal-fold.osf to its kite creases, steps 1–7: the kite creases take the top flap with no chip pressed', async () => {
    let flow = await sheetOf('petal-fold.osf');
    const step = (n: number) => exampleStep(flow.example, n - 1);

    // 1–2. Valley folds, Axiom 2: each moving side one flap, every layer.
    for (const n of [1, 2]) {
      await take(flow, 'valley', 'axiom-2');
      await clickAxiom(flow, step(n));
      await landedStep(flow);
      expectStoredRoot(flow, step(n));
      expect(flow.seen.current?.preview.seed).toEqual({ scope: 'all' });
      ({ flow } = await commitAs(flow, step(n)));
    }

    // 3. Squash the top flap.
    const first = step(3).op;
    if (first.kind !== 'squash') throw new Error('step 3 is a squash');
    await take(flow, 'squash');
    await clickPane(flow.seen, shown(flow, first.flap));
    ({ flow } = await commitAs(flow, step(3)));

    // 4. Turn over, from the rail.
    const before = snapshot().cursor;
    await act(async () => {
      verbsOf(flow).turn({ kind: 'turn-over', axis: 'vertical' });
      await settle();
    });
    const turned = await untilFlow(() => snapshot().cursor !== before && cursor().status === 'ok' && cursor().fingerprint, 'the turn');
    expect(turned).toBe(step(4).expect);
    flow = await remount(flow);

    // 5. Squash the flap now on top: the preliminary base.
    const second = step(5).op;
    if (second.kind !== 'squash') throw new Error('step 5 is a squash');
    await take(flow, 'squash');
    await clickPane(flow.seen, shown(flow, second.flap));
    ({ flow } = await commitAs(flow, step(5)));

    // 6–7. Precrease, Axiom 3: a raw edge onto the centre line. Two flaps lie
    // at each line; the top one, Flap 1, is pressed by default and alone
    // folds — what the README had the folder unpress Flap 2 for.
    for (const n of [6, 7]) {
      await take(flow, 'precrease', 'axiom-3');
      await clickAxiom(flow, step(n));
      await landedStep(flow);
      expectStoredRoot(flow, step(n));
      const { tools } = flow;
      expect(tools.store.getState().seed).toEqual({ scope: 'top' });
      const seed = flow.seen.current?.preview.seed;
      expect(seed?.scope).toBe('flaps');
      const layers = layersShown(flow);
      expect(layers.chips.map((chip) => [chip.name, chip.pressed])).toEqual([
        ['Flap 1', true],
        ['Flap 2', false],
      ]);
      expect(layers.summary).toMatch(/^\d+ of \d+ layers moving$/);
      const stored = step(n).op;
      const committed = await commitAs(flow, step(n));
      flow = committed.flow;
      const { op } = committed;
      expect(op).toMatchObject({ kind: 'precrease', seed: { scope: 'flaps' } });
      if (op.kind !== 'precrease' || stored.kind !== 'precrease' || op.seed.scope !== 'flaps' || stored.seed.scope !== 'flaps') {
        throw new Error('not a flaps precrease');
      }
      // The flap the README left in, named by the engine's witness.
      expect(op.seed.at).toHaveLength(1);
      expect(op.seed.at[0]![0]).toBeCloseTo(stored.seed.at[0]![0], 9);
      expect(op.seed.at[0]![1]).toBeCloseTo(stored.seed.at[0]![1], 9);
    }
  });
});

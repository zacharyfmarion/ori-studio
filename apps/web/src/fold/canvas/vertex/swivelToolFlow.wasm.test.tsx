import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearHeldModifiers, syncHeldModifiersFromEvent } from '../../../keyboard/heldModifiers';
import { foldSessionDocumentSource } from '../../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../../store/workspaceStore/store';
import { sequenceOf } from '../../document/foldSequence.fixtures';
import { initialFoldReaderState, withFoldCursor } from '../../document/foldReaderState';
import type { FoldDirection, FoldOp, FoldStep, FoldSwivelKind, SheetPoint } from '../../document/foldSequenceDocument';
import { createFoldSession, type FoldSession } from '../../session/foldSession';
import { settle } from '../../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../../session/foldSessionState';
import { createFoldTools, type FoldTools } from '../../tools/foldToolState';
import type { FoldSwivelReachView } from '../../tools/vertex/swivelReach';
import { foldVertexWindowView } from '../foldCanvasModel';
import type { FoldPickIndex } from '../foldPicking';
import {
  clickPane,
  commitPreviewed,
  exampleStep as stepAt,
  FOLD_FLOW_AVAILABLE as available,
  FOLD_FLOW_RADII as RADII,
  foldFlowBridge as bridge,
  FoldFlowCanvas as Canvas,
  openedExample as opened,
  shownPickIndex,
  untilFlow as until,
  type FoldFlowSeen as Seen,
} from '../foldToolFlow.fixtures';
import type { FoldStateView } from '../useFoldStateView';

/**
 * The swivel on a folded edge made through the Swivel fold tool, both kinds
 * (owner feedback, 2026-10-12: "did you test that both still work?") — the
 * tool's own pipeline over the session and the real bridge, in-process: the
 * canvas's hit test and pick for each click (`useFoldCanvasVerbs`, whose
 * line clicks take only what the swivel's reach lights), the preview and its
 * reach (`useFoldToolPreview`, `useFoldVertexStep`, `useFoldSwivelReach`),
 * the window's Kind control (`foldVertexWindowView`) and the commit. On the
 * owner's squash (`swivel-on-edge.osf` to its sixth step), the README's three
 * clicks — the kite's upper-left edge where the creases meet, the model's
 * lower-left edge, the centre line — commit the open swivel the example
 * stores, to its fingerprint; with Inside chosen in the window, the inside
 * swivel `swivel-inside.osf` stores.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The README's clicks on the folded pane, in its scene frame (the squash,
 * turned an eighth so the open corner points down): the kite's upper-left
 * edge runs from its left corner to its top, and the creases meet a little
 * past half way up it; the model's lower-left edge; the centre line.
 */
const KITE_LEFT = { x: -0.2071067811865476, y: 0.2071067811865476 };
const KITE_TOP = { x: 0, y: 0.7071067811865476 };
const MEET = { x: KITE_LEFT.x + 0.55 * (KITE_TOP.x - KITE_LEFT.x), y: KITE_LEFT.y + 0.55 * (KITE_TOP.y - KITE_LEFT.y) };
const EDGE = { x: -0.1036, y: 0.1036 };
const CENTRE_LINE = { x: 0, y: 0.55 };

/** The example's seventh step, the swivel, as it stores it. */
function storedSwivel(name: string): FoldStep {
  const step = stepAt(opened(name), 6);
  if (step.op.kind !== 'swivel' || !('fold' in step.op)) throw new Error(`${name}: step 7 is the swivel on a folded edge`);
  return step;
}

/** The line a pane offers through a sheet point: by its id, the one whose sheet stretch holds it. */
function lineThrough(index: FoldPickIndex, at: SheetPoint): number {
  const segment = [...index.folded.segments, ...index.creasePattern.segments].find(({ sheet: [a, b] }) => {
    const cross = (b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0]);
    const along = (at[0] - a[0]) * (b[0] - a[0]) + (at[1] - a[1]) * (b[1] - a[1]);
    const length = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    return Math.abs(cross) < 1e-9 && along > 0 && along < length;
  });
  if (!segment) throw new Error(`no line through ${at.join(', ')}`);
  return segment.edge;
}

let session: FoldSession;
let host: HTMLDivElement;
let root: Root;

const snapshot = () => session.store.getState();
const cursor = () => selectFoldCursorNode(snapshot());

/** The owner's squash on screen, the Swivel fold tool in hand, and the canvas mounted over it. */
async function squashWithSwivel(): Promise<{ tools: FoldTools; index: FoldPickIndex; seen: { current: Seen | null } }> {
  const example = opened('swivel-on-edge.osf');
  // The squash: the example's first six steps, as the owner's own file holds them.
  const document = { ...example, steps: example.steps.slice(0, 6) };
  const squash = stepAt(document, 5);
  const reader = withFoldCursor(initialFoldReaderState(document.id), document, squash.id);
  useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], reader);
  await until(() => snapshot().cursor === squash.id && cursor().status === 'ok' && cursor().summary, 'the squash');
  expect(cursor().fingerprint).toBe(squash.expect);
  const index = await shownPickIndex(session);
  const tools = createFoldTools();
  tools.selectTool('swivel');
  const seen: { current: Seen | null } = { current: null };
  const view = { index } as FoldStateView;
  await act(async () => {
    root.render(<Canvas session={session} tools={tools} view={view} seenRef={seen} />);
    await settle();
  });
  return { tools, index, seen };
}

/** A click on the folded pane where the canvas would take it: its hit test, then its pick. */
const click = (seen: { current: Seen | null }, at: { x: number; y: number }) => clickPane(seen, at);

function readyReach(seen: { current: Seen | null }): FoldSwivelReachView | null {
  const reach = seen.current?.preview.vertex?.reach ?? null;
  return reach?.status === 'ready' ? reach : null;
}

/** The README's three clicks, the lit edges and lines checked as each is offered, kept the folder's way. */
async function threeClicks(seen: { current: Seen | null }, index: FoldPickIndex, stored: FoldStep, direction: FoldDirection = 'valley') {
  if (stored.op.kind !== 'swivel' || !('fold' in stored.op) || stored.op.via !== 'edge') throw new Error('not a swivel on a folded edge');
  const edge = lineThrough(index, stored.op.edge);
  const line = stored.op.target.via === 'crease' ? lineThrough(index, stored.op.target.at) : -1;

  // 1. On the kite's upper-left edge: a point on a folded edge.
  const meet = await click(seen, MEET);
  expect(meet?.pick).toMatchObject({ kind: 'point', fold: { kind: 'segment', segment: 'bend' } });
  const reach = await until(() => readyReach(seen), 'the reach');
  // The edge that swings is lit, and the centre line among the lines it lands on, open.
  expect(reach.edges.has(edge)).toBe(true);
  const landing = reach.targets.get(edge)?.get(line);
  expect(landing?.op).toMatchObject({ kind: 'swivel', via: 'edge', direction });
  expect(landing && 'swivel' in landing.op).toBe(false);
  expect(landing?.kinds).toEqual([true, true]);

  // 2. The model's lower-left edge: taken, as a lit edge.
  const swung = await click(seen, EDGE);
  expect(swung?.pick).toMatchObject({ kind: 'segment', edge });
  // 3. The centre line: taken, as a line that edge lands on.
  const landed = await click(seen, CENTRE_LINE);
  expect(landed?.pick).toMatchObject({ kind: 'segment', edge: line });
}

/** The step the tool previews, once the engine has described it: of the kind asked. */
function previewed(seen: { current: Seen | null }, kind: FoldSwivelKind) {
  const step = seen.current?.preview.step;
  if (!step || step.op.kind !== 'swivel') return null;
  const inside = 'swivel' in step.op && step.op.swivel === 'inside';
  return inside === (kind === 'inside') ? step : null;
}

/** Commit what the tool previews, as Enter does, and wait for the step to land on screen. */
const commit = (seen: { current: Seen | null }) => commitPreviewed(session, seen);

describe.skipIf(!available)('the swivel on a folded edge, made through the Swivel fold tool', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await bridge() });
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

  it('takes a valley and a mountain located with the line modes, previews the crease behind, saves and freshly replays', async () => {
    const document = sequenceOf([]);
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], initialFoldReaderState(document.id));
    await until(() => cursor().status === 'ok', 'the sheet');
    await session.commitStep({ kind: 'valley', line: { via: 'free', through: [[0.5,0],[0.5,1]] }, moving: [0.8,0.5], seed: { scope: 'all' } });
    await until(() => cursor().status === 'ok', 'the book fold');
    const index = await shownPickIndex(session);
    const tools = createFoldTools(); tools.selectTool('swivel');
    const seen: { current: Seen | null } = { current: null };
    await act(async () => { root.render(<Canvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />); await settle(); });
    await act(async () => { seen.current!.verbs.setSwivelInput('valley-mountain'); await settle(); });
    await act(async () => { seen.current!.verbs.selectLineMode('axiom-1'); await settle(); });
    expect(tools.store.getState().tool).toBe('swivel');
    syncHeldModifiersFromEvent({ altKey:true,ctrlKey:false,metaKey:false,shiftKey:false });
    // The valley: the line through the point on the folded edge and one up the paper.
    const meet = await clickPane(seen, { x:0.5,y:0.5 }, 'crease-pattern');
    expect(meet?.pick).toMatchObject({ kind: 'point' });
    expect(meet?.pick).not.toHaveProperty('fold');
    await clickPane(seen, { x:0.1,y:0.8 }, 'crease-pattern');
    await until(() => seen.current?.preview.locatedLine, 'the valley line');
    expect(seen.current?.preview.step).toBeNull();
    const before = snapshot().sequence!.steps.length;
    // Enter takes it as the valley: no step yet, and the picks go on to the mountain.
    await act(async () => { expect(seen.current!.verbs.commit()).toBe(true); await settle(); });
    expect(snapshot().sequence!.steps).toHaveLength(before);
    expect(tools.store.getState().picks).toHaveLength(0);
    expect(tools.store.getState().takenLine?.root).toBeDefined();
    // The mountain, a construction of its own with its own root.
    await clickPane(seen, { x:0.5,y:0.5 }, 'crease-pattern');
    await clickPane(seen, { x:0.05,y:0.1 }, 'crease-pattern');
    clearHeldModifiers();
    await until(() => seen.current?.preview.landed, 'the valley-and-mountain preview');
    const asked = seen.current?.preview.step?.op;
    expect(asked).toMatchObject({ kind:'swivel',via:'valley-mountain',valley:{line:{via:'axiom',axiom:1}},mountain:{line:{via:'axiom',axiom:1}} });
    // Its letters are the viewer's: no direction is stored, and none offered.
    expect(asked).not.toHaveProperty('direction');
    const window = foldVertexWindowView(tools.store.getState(),seen.current!.preview)!;
    expect(window.lineBy).toBeUndefined();
    expect(window.lineTaken).toBe(true);
    // The crease behind is previewed, dotted where the front layer hides it.
    const analysis = seen.current!.preview.vertex?.base?.analysis;
    expect(analysis?.kind).toBe('swivel-valley-mountain');
    expect(analysis && 'creases' in analysis ? analysis.creases[0]?.hidden : undefined).toBe(true);
    await commit(seen);
    const saved = snapshot().sequence!.steps.at(-1) as FoldStep;
    expect(saved.op).toMatchObject({ via:'valley-mountain' });
    session.dispose();
    session=createFoldSession({ document:foldSessionDocumentSource(useWorkspaceStore),runtime:await bridge() });session.retain();
    await until(() => cursor().status==='ok' && cursor().fingerprint===saved.expect,'fresh replay of the valley and mountain');
  });

  it('makes both saved swivels on the kite again by their valley and mountain, the mountain from where the valley meets the folded edge', async () => {
    // The flap's right corner, where the hinge ends, and the model's bottom tip.
    const CORNER = { x: 0.2071067811865476, y: 0.2071067811865476 };
    const TIP = { x: 0, y: 0 };
    // Where the hinge, square to the kite's upper-left edge through the corner, meets that edge.
    const V = { x: -0.1464466094067262, y: 0.3535533905932738 };
    for (const [name, kind] of [['swivel-on-edge.osf', 'open'], ['swivel-inside.osf', 'inside']] as const) {
      const stored = storedSwivel(name);
      const { seen } = await squashWithSwivel();
      await act(async () => { seen.current!.verbs.setSwivelInput('valley-mountain'); await settle(); });
      // Inside is asked before any pick: asked open, these lines are refused, and the kind stays through every locate.
      if (kind === 'inside') await act(async () => { seen.current!.verbs.setSwivelKind('inside'); await settle(); });
      // The valley, constructed: open, the hinge square to the kite's edge through the corner (Axiom 4);
      // inside, the lower-left edge laid on the centre line (Axiom 3), through the tip.
      await act(async () => { seen.current!.verbs.selectLineMode(kind === 'open' ? 'axiom-4' : 'axiom-3'); await settle(); });
      for (const at of kind === 'open' ? [MEET, CORNER] : [EDGE, CENTRE_LINE]) await click(seen, at);
      await until(() => seen.current?.preview.locatedLine, 'the valley line');
      await act(async () => { expect(seen.current!.verbs.commit()).toBe(true); await settle(); });
      // The mountain through two points, the first where the valley meets the folded edge: that point exactly.
      await act(async () => { seen.current!.verbs.selectLineMode('axiom-1'); await settle(); });
      const near = { x: V.x + 0.004, y: V.y - 0.003 };
      const meeting = await click(seen, near);
      expect(meeting?.pick).toMatchObject({ kind: 'point', provenance: 'fold' });
      const scene = meeting?.pick?.kind === 'point' ? meeting.pick.scene : null;
      expect(Math.hypot((scene?.x ?? NaN) - V.x, (scene?.y ?? NaN) - V.y)).toBeLessThan(1e-12);
      await click(seen, kind === 'open' ? TIP : CORNER);
      const step = await until(() => previewed(seen, kind), `the ${kind} preview`);
      expect(step.op).toMatchObject({ kind: 'swivel', via: 'valley-mountain', mountain: { line: { via: 'axiom', axiom: 1 } } });
      const committed = await commit(seen);
      expect(committed.fingerprint, name).toBe(stored.expect);
      act(() => root.unmount());
      root = createRoot(host);
    }
  });

  it('requires a saved order for a matching swivel and cycles before committing', async () => {
    const t = Math.tan(Math.PI / 8);
    const document = sequenceOf([]);
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], initialFoldReaderState(document.id));
    await until(() => cursor().status === 'ok', 'the sheet');
    const base: FoldOp[] = [
      { kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[0, 0], [1, 1]] }, moving: [0.75, 0.25], seed: { scope: 'all' } },
      { kind: 'valley', line: { via: 'free', through: [[0, 0], [1, t]] }, moving: [0.9, 0.1], seed: { scope: 'all' } },
      { kind: 'valley', line: { via: 'free', through: [[0, 0], [t, 1]] }, moving: [0.1, 0.9], seed: { scope: 'all' } },
    ];
    for (const op of base) {
      await session.commitStep(op);
      await until(() => cursor().status === 'ok', 'the kite fold');
    }
    const first = { kind: 'swivel', via: 'edge', fold: [0.5, t / 2], edge: [1, (t + 1) / 2], target: { via: 'crease', at: [0.5, 0.5] }, direction: 'valley' } as const;
    const answer = await session.withCursor((engine, state) => engine.orderSelection(state, first, undefined, { index: 0 }));
    if (answer.status !== 'answered' || answer.value.status !== 'ok' || !answer.value.completion) throw new Error('no first swivel order');
    await session.commitStep(first, { completion: answer.value.completion });
    await until(() => cursor().status === 'ok', 'the first swivel');
    const index = await shownPickIndex(session);
    const tools = createFoldTools(); tools.selectTool('swivel');
    const seen: { current: Seen | null } = { current: null };
    await act(async () => { root.render(<Canvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />); await settle(); });
    await clickPane(seen, { x: t / 2, y: 0.5 }, 'crease-pattern');
    await until(() => readyReach(seen), 'the matching swivel reach');
    await clickPane(seen, { x: (t + 1) / 2, y: 1 }, 'crease-pattern');
    await clickPane(seen, { x: 0.5, y: 0.5 }, 'crease-pattern');
    await until(() => seen.current?.preview.orderResolution?.required && seen.current.preview.landed, 'required order selection');
    const before = snapshot().cursor;
    await act(async () => { seen.current!.verbs.commit(); await settle(); });
    expect(snapshot().cursor).toBe(before);
    const initial = seen.current!.preview.step!.key;
    await act(async () => { seen.current!.verbs.stepChoice(1); await settle(); });
    await until(() => seen.current?.preview.step?.key !== initial && seen.current?.preview.landed, 'another valid order');
    expect(snapshot().cursor).toBe(before);
    const selected = seen.current!.preview.step!.choices?.completion;
    expect(selected?.orders.length).toBeGreaterThan(0);
    await commit(seen);
    const saved = snapshot().sequence!.steps.at(-1) as FoldStep;
    expect(saved.choices?.completion).toEqual(selected);
    const fresh = await bridge();
    // Reopening this chosen sequence must replay the same local order.
    session.dispose();
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: fresh });
    session.retain();
    await until(() => cursor().status === 'ok' && cursor().fingerprint === saved.expect, 'the saved order in a fresh engine');
  });

  it('commits the open swivel by default, Kind offering both, to the fingerprint swivel-on-edge.osf stores', async () => {
    const stored = storedSwivel('swivel-on-edge.osf');
    const { tools, index, seen } = await squashWithSwivel();
    await threeClicks(seen, index, stored);
    const step = await until(() => previewed(seen, 'open'), 'the open preview');
    expect(step.op).toMatchObject({ kind: 'swivel', via: 'edge', direction: 'valley', target: { via: 'crease' } });
    // The window offers both kinds, Open taken; no Direction (only valley lands).
    const window = foldVertexWindowView(tools.store.getState(), seen.current!.preview);
    expect(window).toMatchObject({ onFold: true, swivelKind: 'open', swivelKinds: ['open', 'inside'], directions: [true, false] });
    const committed = await commit(seen);
    expect(committed.op).toMatchObject({ kind: 'swivel', via: 'edge', direction: 'valley' });
    expect('swivel' in committed.op).toBe(false);
    expect(committed.fingerprint).toBe(stored.expect);
  });

  it('takes the kite edge with Option held, the lower-left edge along its whole length, and commits the same open swivel from either end of it', async () => {
    // Owner report, 2026-10-13: a click on the kite's edge, level with the
    // model's side corners, lit the upper-left outer edge and the lower-right
    // one, never the lower-left edge, and the centre line then previewed a
    // fan over the whole left side — a pivot through every layer, which is
    // what Alt held (or stuck) made of that click.
    const stored = storedSwivel('swivel-on-edge.osf');
    for (const end of [
      { x: -0.3, y: 0.3 },
      { x: -0.1036, y: 0.1036 },
    ]) {
      const { seen } = await squashWithSwivel();
      const level = { x: KITE_LEFT.x + 0.293 * (KITE_TOP.x - KITE_LEFT.x), y: KITE_LEFT.y + 0.293 * (KITE_TOP.y - KITE_LEFT.y) };
      syncHeldModifiersFromEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false });
      const meet = await click(seen, level);
      clearHeldModifiers();
      expect(meet?.pick).toMatchObject({ kind: 'point', fold: { kind: 'segment', segment: 'bend' } });
      await until(() => readyReach(seen), 'the reach');
      // Every point of the lower-left edge, from the left corner to the tip, takes an edge that swings.
      for (let k = 1; k < 20; k += 1) {
        const u = k / 20;
        const hit = seen.current!.verbs.hitTest('folded', { x: -0.35355 * (1 - u), y: 0.35355 * (1 - u) }, RADII);
        expect(hit?.pick?.kind, `lower-left edge at ${u}`).toBe('segment');
      }
      const swung = await click(seen, end);
      expect(swung?.pick?.kind).toBe('segment');
      const landed = await click(seen, CENTRE_LINE);
      expect(landed?.pick?.kind).toBe('segment');
      await until(() => previewed(seen, 'open'), 'the open preview');
      const committed = await commit(seen);
      expect(committed.op).toMatchObject({ kind: 'swivel', via: 'edge', direction: 'valley' });
      expect(committed.fingerprint).toBe(stored.expect);
      // The next end starts from the squash again.
      act(() => root.unmount());
      root = createRoot(host);
    }
  });

  it('commits the inside swivel when Inside is chosen in the window, to the fingerprint swivel-inside.osf stores', async () => {
    const stored = storedSwivel('swivel-inside.osf');
    const { tools, index, seen } = await squashWithSwivel();
    await threeClicks(seen, index, stored);
    await until(() => previewed(seen, 'open'), 'the open preview');
    await act(async () => {
      seen.current?.verbs.setSwivelKind('inside');
      await settle();
    });
    const step = await until(() => previewed(seen, 'inside'), 'the inside preview');
    expect(step.op).toMatchObject({ kind: 'swivel', via: 'edge', direction: 'valley', swivel: 'inside' });
    expect(foldVertexWindowView(tools.store.getState(), seen.current!.preview)).toMatchObject({
      swivelKind: 'inside',
      swivelKinds: ['open', 'inside'],
    });
    const committed = await commit(seen);
    expect(committed.op).toMatchObject({ kind: 'swivel', via: 'edge', direction: 'valley', swivel: 'inside' });
    expect(committed.fingerprint).toBe(stored.expect);
  });

  it('refuses the swivel asked as a mountain, which lands only as a valley, and folds it the other way only at the fix', async () => {
    const stored = storedSwivel('swivel-on-edge.osf');
    const { tools, index, seen } = await squashWithSwivel();
    await act(async () => {
      tools.setVertexDirection('mountain');
      await settle();
    });
    await threeClicks(seen, index, stored, 'mountain');
    // Asked as a mountain, it is previewed as a mountain, and refused: never valley without a word.
    const refused = await until(() => seen.current?.preview.refused, 'the mountain refused');
    expect(seen.current?.preview.vertex?.direction).toBe('mountain');
    expect(seen.current?.preview.step).toBeNull();
    expect(refused.fixes).toContainEqual({ fix: 'opposite_direction' });
    expect(foldVertexWindowView(tools.store.getState(), seen.current!.preview)).toMatchObject({
      direction: 'mountain',
      directions: [true, false],
    });
    // The fix folds it the other way: the folder's own press.
    await act(async () => {
      seen.current!.verbs.vertexOtherWay();
      await settle();
    });
    const step = await until(() => !seen.current?.preview.refused && previewed(seen, 'open'), 'the valley preview');
    expect(step.op).toMatchObject({ direction: 'valley' });
    const committed = await commit(seen);
    expect('swivel' in committed.op).toBe(false);
    expect(committed.fingerprint).toBe(stored.expect);
  });

  it('commits a swivel at a free pivot, Option held, as swivel-fold.osf stores its first branch: no Kind to choose', async () => {
    const example = opened('swivel-fold.osf');
    const stored = stepAt(example, 1);
    if (stored.op.kind !== 'swivel' || !('pivot' in stored.op)) throw new Error('step 2 is a swivel at a pivot');
    // The precreased diagonal on screen: the file's first step.
    const document = { ...example, steps: example.steps.slice(0, 1) };
    const precrease = stepAt(document, 0);
    const reader = withFoldCursor(initialFoldReaderState(document.id), document, precrease.id);
    useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], reader);
    await until(() => snapshot().cursor === precrease.id && cursor().status === 'ok' && cursor().summary, 'the precrease');
    const index = await shownPickIndex(session);
    const tools = createFoldTools();
    tools.selectTool('swivel');
    const seen: { current: Seen | null } = { current: null };
    await act(async () => {
      root.render(<Canvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
      await settle();
    });
    // On the crease-pattern pane, in sheet units: the pivot with Option held, the bottom edge, the diagonal.
    const [px, py] = stored.op.pivot;
    syncHeldModifiersFromEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false });
    const pivot = seen.current!.verbs.hitTest('crease-pattern', { x: px, y: py }, RADII);
    clearHeldModifiers();
    expect(pivot?.pick).toMatchObject({ kind: 'point', sheet: [px, py] });
    await act(async () => {
      seen.current!.verbs.pick(pivot);
      await settle();
    });
    const reach = await until(() => readyReach(seen), 'the reach');
    const edge = lineThrough(index, stored.op.edge);
    const line = stored.op.target.via === 'crease' ? lineThrough(index, stored.op.target.at) : -1;
    expect(reach.targets.get(edge)?.has(line)).toBe(true);
    for (const at of [{ x: 0.5, y: 0.002 }, { x: 0.5, y: 0.5 }]) {
      const hit = seen.current!.verbs.hitTest('crease-pattern', at, RADII);
      expect(hit?.pick?.kind).toBe('segment');
      await act(async () => {
        seen.current!.verbs.pick(hit);
        await settle();
      });
    }
    const step = await until(() => seen.current?.preview.step, 'the preview');
    expect(step.op).toEqual(stored.op);
    const window = foldVertexWindowView(tools.store.getState(), seen.current!.preview);
    expect(window?.onFold).toBeUndefined();
    expect(window?.swivelKinds).toBeUndefined();
    const committed = await commit(seen);
    expect(committed.op).toEqual(stored.op);
    expect(committed.fingerprint).toBe(stored.expect);
  });

  it('commits the open swivel again after Inside was chosen and taken back', async () => {
    const stored = storedSwivel('swivel-on-edge.osf');
    const { index, seen } = await squashWithSwivel();
    await threeClicks(seen, index, stored);
    await until(() => previewed(seen, 'open'), 'the open preview');
    await act(async () => {
      seen.current?.verbs.setSwivelKind('inside');
      await settle();
    });
    await until(() => previewed(seen, 'inside'), 'the inside preview');
    await act(async () => {
      seen.current?.verbs.setSwivelKind('open');
      await settle();
    });
    await until(() => previewed(seen, 'open'), 'the open preview again');
    const committed = await commit(seen);
    expect('swivel' in committed.op).toBe(false);
    expect(committed.fingerprint).toBe(stored.expect);
  });
});

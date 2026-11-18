import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearHeldModifiers, syncHeldModifiersFromEvent } from '../../../keyboard/heldModifiers';
import { foldSessionDocumentSource } from '../../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../../store/workspaceStore/store';
import { sequenceOf } from '../../document/foldSequence.fixtures';
import { initialFoldReaderState } from '../../document/foldReaderState';
import type { FoldStep } from '../../document/foldSequenceDocument';
import { createFoldSession, type FoldSession } from '../../session/foldSession';
import { settle } from '../../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../../session/foldSessionState';
import { createFoldTools, type FoldTools } from '../../tools/foldToolState';
import { foldVertexWindowView } from '../foldCanvasModel';
import {
  clickPane,
  commitPreviewed,
  FOLD_FLOW_AVAILABLE as available,
  foldFlowBridge as bridge,
  FoldFlowCanvas as Canvas,
  shownPickIndex,
  untilFlow as until,
  type FoldFlowSeen as Seen,
} from '../foldToolFlow.fixtures';
import type { FoldStateView } from '../useFoldStateView';

/**
 * Two swivels made together through the Swivel fold tool, by their valleys
 * and mountains: a square's side strips folded to the middle in front, then
 * on each flap a swivel at its folded edge's point on y = 1/4, the crease
 * behind both running across from one to the other. The tool's own pipeline
 * over the session and the real bridge: the first swivel's preview offers
 * its other end, the window's button takes it, the second swivel's lines are
 * located — the valley taken with Enter, then the mountain — and the pair is
 * previewed, committed with its other end, and freshly replayed. And the
 * single swivel, made as before, is committed alone (owner feedback,
 * 2026-10-12: every old variant is made again through the tool).
 *
 * Skipped when the bridge has not been built.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let session: FoldSession;
let host: HTMLDivElement;
let root: Root;

const snapshot = () => session.store.getState();
const cursor = () => selectFoldCursorNode(snapshot());

/** The cupboard on screen, the Swivel fold tool in hand by its valley and mountain, lines through two free points on the crease pattern. */
async function cupboard(): Promise<{ tools: FoldTools; seen: { current: Seen | null } }> {
  const document = sequenceOf([]);
  useWorkspaceStore.getState().installFoldSequences([{ document, readOnlyRaw: null }], initialFoldReaderState(document.id));
  await until(() => cursor().status === 'ok', 'the sheet');
  await session.commitStep({ kind: 'valley', line: { via: 'free', through: [[0.25, 0], [0.25, 1]] }, moving: [0.1, 0.5], seed: { scope: 'all' } });
  await until(() => cursor().status === 'ok' && snapshot().sequence!.steps.length === 1, 'the left strip');
  await session.commitStep({ kind: 'valley', line: { via: 'free', through: [[0.75, 0], [0.75, 1]] }, moving: [0.9, 0.5], seed: { scope: 'all' } });
  await until(() => cursor().status === 'ok' && snapshot().sequence!.steps.length === 2, 'the right strip');
  const index = await shownPickIndex(session);
  const tools = createFoldTools();
  tools.selectTool('swivel');
  const seen: { current: Seen | null } = { current: null };
  await act(async () => {
    root.render(<Canvas session={session} tools={tools} view={{ index } as FoldStateView} seenRef={seen} />);
    await settle();
  });
  await act(async () => {
    seen.current!.verbs.setSwivelInput('valley-mountain');
    await settle();
  });
  await act(async () => {
    seen.current!.verbs.selectLineMode('axiom-1');
    await settle();
  });
  return { tools, seen };
}

/** A line through two free points on the crease pattern, Alt held: its picks. */
async function line(seen: { current: Seen | null }, from: [number, number], to: [number, number]) {
  syncHeldModifiersFromEvent({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false });
  await clickPane(seen, { x: from[0], y: from[1] }, 'crease-pattern');
  await clickPane(seen, { x: to[0], y: to[1] }, 'crease-pattern');
  clearHeldModifiers();
  await until(() => seen.current?.preview.locatedLine, 'the line');
}

/** Enter: take the line located. */
async function enter(seen: { current: Seen | null }) {
  await act(async () => {
    expect(seen.current!.verbs.commit()).toBe(true);
    await settle();
  });
}

/** On the left flap: its valley up toward the middle, its mountain down to the bottom edge. */
const LEFT = { valley: [[0.25, 0.25], [0.15, 0.35]], mountain: [[0.25, 0.25], [0.15, 0.15]] } as const;
const RIGHT = { valley: [[0.75, 0.25], [0.85, 0.35]], mountain: [[0.75, 0.25], [0.85, 0.15]] } as const;

describe.skipIf(!available)('two swivels made together, through the Swivel fold tool', () => {
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

  it('offers the other end of the crease behind, takes the second swivel there, and commits both as one step', async () => {
    const { tools, seen } = await cupboard();
    await line(seen, LEFT.valley[0] as [number, number], LEFT.valley[1] as [number, number]);
    await enter(seen);
    await line(seen, LEFT.mountain[0] as [number, number], LEFT.mountain[1] as [number, number]);
    await until(() => seen.current?.preview.landed, 'the first swivel');
    // The first swivel alone previews, and its crease behind runs on to the other flap's folded edge.
    let window = foldVertexWindowView(tools.store.getState(), seen.current!.preview)!;
    expect(window.otherEnd).toEqual({ locating: false, shared: 'behind' });
    expect(seen.current!.preview.step?.op).not.toHaveProperty('otherEnd');
    // Swivel there too: the first is held, and the second's lines are located.
    await act(async () => {
      seen.current!.verbs.swivelOtherEnd();
      await settle();
    });
    const held = tools.store.getState();
    expect(held.otherEnd?.shared).toBe('behind');
    expect(held.takenLine).toBeUndefined();
    expect(held.picks).toHaveLength(0);
    window = foldVertexWindowView(held, seen.current!.preview)!;
    expect(window.otherEnd).toEqual({ locating: true, shared: 'behind' });
    expect(window.lineTaken).toBe(false);
    const before = snapshot().sequence!.steps.length;
    await line(seen, RIGHT.valley[0] as [number, number], RIGHT.valley[1] as [number, number]);
    // No fold until both of the second's lines are in: Enter takes its valley.
    expect(seen.current?.preview.step).toBeNull();
    await enter(seen);
    expect(snapshot().sequence!.steps).toHaveLength(before);
    expect(tools.store.getState().otherEnd).toBeDefined();
    expect(tools.store.getState().takenLine).toBeDefined();
    await line(seen, RIGHT.mountain[0] as [number, number], RIGHT.mountain[1] as [number, number]);
    const step = await until(() => {
      const op = seen.current?.preview.landed ? seen.current.preview.step?.op : null;
      return op && 'otherEnd' in op && op.otherEnd ? op : null;
    }, 'the pair');
    expect(step).toMatchObject({
      kind: 'swivel',
      via: 'valley-mountain',
      valley: { line: { via: 'axiom', axiom: 1 } },
      mountain: { line: { via: 'axiom', axiom: 1 } },
      otherEnd: { valley: { line: { via: 'axiom', axiom: 1 } }, mountain: { line: { via: 'axiom', axiom: 1 } } },
    });
    // Previewed as one: the second's vertex is the other end, and nothing more is offered.
    const analysis = seen.current!.preview.vertex?.base?.analysis;
    expect(analysis?.kind === 'swivel-valley-mountain' ? analysis.other_end?.shared : null).toBe('behind');
    expect(foldVertexWindowView(tools.store.getState(), seen.current!.preview)!.otherEnd?.locating).toBe(true);
    const committed = await commitPreviewed(session, seen);
    expect(committed.op).toMatchObject({ otherEnd: {} });
    expect(tools.store.getState().otherEnd).toBeUndefined();
    const saved = snapshot().sequence!.steps.at(-1) as FoldStep;
    session.dispose();
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await bridge() });
    session.retain();
    await until(() => cursor().status === 'ok' && cursor().fingerprint === saved.expect, 'a fresh replay of the pair');
  });

  it('still commits the single swivel when its other end is not taken', async () => {
    const { tools, seen } = await cupboard();
    await line(seen, LEFT.valley[0] as [number, number], LEFT.valley[1] as [number, number]);
    await enter(seen);
    await line(seen, LEFT.mountain[0] as [number, number], LEFT.mountain[1] as [number, number]);
    await until(() => seen.current?.preview.landed, 'the single swivel');
    expect(foldVertexWindowView(tools.store.getState(), seen.current!.preview)!.otherEnd?.locating).toBe(false);
    const committed = await commitPreviewed(session, seen);
    expect(committed.op).toMatchObject({ kind: 'swivel', via: 'valley-mountain' });
    expect(committed.op).not.toHaveProperty('otherEnd');
  });

  it('lets go of the first swivel with Escape at the other end', async () => {
    const { tools, seen } = await cupboard();
    await line(seen, LEFT.valley[0] as [number, number], LEFT.valley[1] as [number, number]);
    await enter(seen);
    await line(seen, LEFT.mountain[0] as [number, number], LEFT.mountain[1] as [number, number]);
    await until(() => seen.current?.preview.landed, 'the first swivel');
    await act(async () => {
      seen.current!.verbs.swivelOtherEnd();
      await settle();
    });
    expect(tools.store.getState().otherEnd).toBeDefined();
    await act(async () => {
      expect(seen.current!.verbs.cancel()).toBe(true);
      await settle();
    });
    expect(tools.store.getState().otherEnd).toBeUndefined();
    expect(tools.store.getState().takenLine).toBeUndefined();
  });
});

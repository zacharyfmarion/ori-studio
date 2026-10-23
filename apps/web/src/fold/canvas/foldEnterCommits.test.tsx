import { foldToolInputKey } from '../tools/foldToolState';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppKeyboardListener } from '../../lib/appKeyboard';
import type { Selection } from '../../lib/sampleProject';
import type { FoldOp, FoldPrecreaseExtent, SheetPoint } from '../document/foldSequenceDocument';
import { FOLD_LAYER_PICK_ATTRIBUTE } from '../sequence/foldLayerPickFocus';
import { useFoldKeyboard } from '../sequence/foldKeys';
import type { FoldSessionSurface } from '../session/useFoldSession';
import type { FoldToolId } from '../tools/foldToolCatalog';
import { createFoldTools, type FoldTools } from '../tools/foldToolState';
import type { FoldExtentState } from '../tools/precrease/precreaseExtent';
import { flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import { foldAlongLine } from './foldAlongLine';
import { registerFoldCanvasVerbs } from './foldCanvasCommands';
import { foldPickIndex } from './foldPicking';
import { FOLD_PANE_ATTRIBUTE, useFoldCanvasShortcuts } from './useFoldCanvasShortcuts';
import { useFoldCanvasVerbs } from './useFoldCanvasVerbs';
import type { FoldStateView } from './useFoldStateView';
import type { FoldToolPreview } from './useFoldToolPreview';

/**
 * Enter commits the fold previewed, through the whole path a keypress takes:
 * the app's listener (capture phase on the document), the registry's `fold`
 * scope and the Fold panel's executor (`useFoldKeyboard`), the canvas's
 * handler (`useFoldCanvasShortcuts`) and the canvas's own verbs
 * (`useFoldCanvasVerbs`, registered as `FoldCanvas` registers them) — for
 * every tool's preview, from every focus that leaves Enter to the fold, and
 * never from a focused control that keeps Enter for itself.
 *
 * Keys are dispatched where a browser sends them: at the focused element, or
 * the body with nothing focused. (A synthetic event dispatched at `window`
 * never reaches the document's listener: the window is above the document in
 * the event's path. A probe that presses Enter that way presses nothing.)
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ALL = { scope: 'all' } as const;
const DIAGONAL = { via: 'axiom', axiom: 2, inputs: [{ kind: 'point', at: [0, 1] }, { kind: 'point', at: [1, 0] }] } as const;
const ACROSS = { via: 'free', through: [[0.55, 0.5], [0.95, 0.5]] } as const;
const SECOND = { via: 'free', through: [[0.3, 0.8], [0.45, 0.95]] } as const;
const RING: readonly [SheetPoint, SheetPoint] = [[0.35, 0.35], [0.2, 0.5]];
const SEGMENT: FoldPrecreaseExtent = { kind: 'segment', from: { kind: 'point', at: [0.5, 0.5] }, to: { kind: 'point', at: [1, 1] } };
const PINCH: FoldPrecreaseExtent = { kind: 'pinch', at: { kind: 'point', at: [0.5, 0.5] }, length: 0.1 };

/** Each tool's fold, as its preview builds it: the tool in hand, the op it commits, and a precrease's extent. */
const FOLDS: { name: string; tool: FoldToolId; op: FoldOp; extent?: FoldPrecreaseExtent }[] = [
  { name: 'a valley fold', tool: 'valley', op: { kind: 'valley', line: DIAGONAL, seed: ALL } },
  { name: 'a mountain fold', tool: 'mountain', op: { kind: 'mountain', line: DIAGONAL, seed: ALL } },
  { name: 'a precrease of the whole line', tool: 'precrease', op: { kind: 'precrease', line: DIAGONAL, direction: 'valley', seed: ALL } },
  {
    name: 'a precrease of a segment',
    tool: 'precrease',
    op: { kind: 'precrease', line: DIAGONAL, direction: 'valley', seed: ALL, extent: SEGMENT },
    extent: SEGMENT,
  },
  {
    name: 'a pinch',
    tool: 'precrease',
    op: { kind: 'precrease', line: DIAGONAL, direction: 'valley', seed: ALL, extent: PINCH },
    extent: PINCH,
  },
  { name: 'an inside reverse fold', tool: 'inside-reverse', op: { kind: 'inside-reverse', line: ACROSS, seed: ALL } },
  // The reverse tool's other kind, chosen in its window.
  { name: 'an outside reverse fold', tool: 'inside-reverse', op: { kind: 'outside-reverse', line: ACROSS, seed: ALL } },
  { name: 'a crimp', tool: 'crimp', op: { kind: 'crimp', line: ACROSS, second: SECOND, crimp: 'inside', seed: ALL } },
  {
    name: 'a tuck',
    tool: 'tuck',
    op: { kind: 'tuck', line: ACROSS, direction: 'valley', target: [0.75, 0.5], seed: { scope: 'flaps', at: [[0.95, 0.05]] } },
  },
  { name: 'a squash fold', tool: 'squash', op: { kind: 'squash', flap: [0.5, 0.1], direction: 'valley' } },
  { name: 'a petal fold', tool: 'petal', op: { kind: 'petal', crease: [0.28, 0.57], petal: [0.2, 0.74], direction: 'valley' } },
  {
    name: 'a rabbit ear',
    tool: 'rabbit-ear',
    op: { kind: 'rabbit-ear', corners: [[0, 0], [1, 0], [1, 1]], emergent: [0, 1], seed: ALL, stayer: [0.25, 0.75], direction: 'valley' },
  },
  {
    name: 'a swivel fold',
    tool: 'swivel',
    op: {
      kind: 'swivel',
      vertex: [0.5, 0.25],
      toward: [[1, 0.5], [0, 0.5], [0.5, 0]],
      emergent: [0, 1],
      seed: ALL,
      stayer: [0.15, 0.15],
      direction: 'valley',
    },
  },
  { name: 'an open sink', tool: 'open-sink', op: { kind: 'open-sink', line: { via: 'free', through: RING }, seed: ALL } },
  { name: 'a closed sink', tool: 'closed-sink', op: { kind: 'closed-sink', line: { via: 'free', through: RING }, seed: ALL } },
  { name: 'an unsink', tool: 'unsink', op: { kind: 'unsink', line: { via: 'crease', at: [0.275, 0.425] }, seed: ALL } },
];

const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
const DIAGONAL_SCENE = { n: [Math.SQRT1_2, -Math.SQRT1_2] as [number, number], d: 0 };
const along = { folded: foldAlongLine(index, DIAGONAL_SCENE, 'folded'), creasePattern: foldAlongLine(index, DIAGONAL_SCENE, 'crease-pattern') };

/** A preview landed for `op`: what the canvas holds once the engine has answered, its commit button enabled. */
function landed(op: FoldOp, extent: FoldExtentState | null = null, extra: Partial<FoldToolPreview> = {}): FoldToolPreview {
  return {
    candidates: null,
    build: { status: 'unlocated' },
    seed: { scope: 'all' },
    step: { op, key: JSON.stringify(op) },
    analysis: null,
    section: null,
    action: null,
    landed: null,
    refused: null,
    landing: false,
    reverse: null,
    crimp: null,
    tuck: null,
    vertex: null,
    sink: null,
    extent: extent ? { state: extent, along } : null,
    turned: null,
    ...extra,
  };
}

function surface(commitStep: FoldSessionSurface['commitStep']): FoldSessionSurface {
  return {
    cursor: { status: 'ok', path: null, state: null, fingerprint: null, summary: null, report: null, refusal: null },
    cursorId: null,
    readOnly: false,
    pending: { status: 'idle' },
    analysis: { status: 'idle' },
    error: null,
    analyse: vi.fn(),
    preview: vi.fn(),
    commitStep,
    cancel: vi.fn(),
    withState: vi.fn(),
    withNode: vi.fn(),
    withCursor: vi.fn(),
    query: vi.fn(),
    retry: vi.fn(),
  } as unknown as FoldSessionSurface;
}

const NO_CAMERA = { zoomIn: () => undefined, zoomOut: () => undefined, fit: () => undefined, actualSize: () => undefined };

/**
 * What the Fold panel mounts for its keys, and the surfaces focus can be in:
 * a pane, the tool window's layer controls, its buttons, a field and a
 * select.
 */
function Fold({ session, tools, preview }: { session: FoldSessionSurface; tools: FoldTools; preview: FoldToolPreview }) {
  useFoldKeyboard();
  const { verbs } = useFoldCanvasVerbs(session, tools, {} as FoldStateView, preview);
  useEffect(() => registerFoldCanvasVerbs(verbs), [verbs]);
  useFoldCanvasShortcuts(NO_CAMERA);
  return (
    <>
      <div {...{ [FOLD_PANE_ATTRIBUTE]: 'folded' }} tabIndex={0} aria-label="Folded" />
      <div {...{ [FOLD_LAYER_PICK_ATTRIBUTE]: '' }}>
        <button type="button">Flap 1</button>
      </div>
      <button type="button">Swap</button>
      <button type="button" onClick={() => verbs.commit()}>
        Valley fold
      </button>
      <button type="button" onClick={() => verbs.acceptOrder?.()}>Use this order</button>
      <input aria-label="Ratio" defaultValue="0.5" />
      <select aria-label="Locate line" defaultValue="axiom-2">
        <option value="axiom-2">Axiom 2</option>
      </select>
    </>
  );
}

let host: HTMLDivElement;
let root: Root;
let uninstall: () => void;
let commitStep: ReturnType<typeof vi.fn<FoldSessionSurface['commitStep']>>;
let session: FoldSessionSurface;
let tools: FoldTools;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  uninstall = installAppKeyboardListener({
    getActiveEditingContext: () => 'fold',
    getSelection: () => ({ nodes: [], edges: [] }) as unknown as Selection,
    handleMenuAction: () => undefined,
    selectNone: () => undefined,
  });
  commitStep = vi.fn<FoldSessionSurface['commitStep']>(() => Promise.resolve({ status: 'stale' as const }));
  session = surface(commitStep);
  tools = createFoldTools();
});

afterEach(() => {
  act(() => root.unmount());
  uninstall();
  host.remove();
});

const render = (preview: FoldToolPreview) => act(() => root.render(<Fold session={session} tools={tools} preview={preview} />));

/** Focus on `element`, or on nothing (the body) for null. */
function focus(element: HTMLElement | null) {
  act(() => {
    if (element) element.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(document.activeElement).toBe(element ?? document.body);
}

/** Enter as a browser sends it: at the focused element. The event, to read whether it was claimed. */
function enter(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

const pane = () => host.querySelector<HTMLElement>(`[${FOLD_PANE_ATTRIBUTE}]`)!;
const chip = () => host.querySelector<HTMLElement>(`[${FOLD_LAYER_PICK_ATTRIBUTE}] button`)!;
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)!;

describe('Enter commits every tool’s preview', () => {
  for (const fold of FOLDS) {
    it(`commits ${fold.name}`, () => {
      render(landed(fold.op));
      act(() => {
        tools.selectTool(fold.tool);
        if (fold.extent) tools.setExtent(fold.extent.kind);
      });
      render(landed(fold.op, fold.extent ? { status: 'ready', extent: fold.extent } : null));
      focus(null);
      const event = enter();
      expect(commitStep).toHaveBeenCalledExactlyOnceWith(fold.op, undefined);
      expect(event.defaultPrevented).toBe(true);
    });
  }

  it('commits a preview pressed while it lands, once it has', () => {
    render(landed(FOLDS[0]!.op, null, { landing: true }));
    focus(null);
    expect(enter().defaultPrevented).toBe(true);
    expect(commitStep).not.toHaveBeenCalled();
    render(landed(FOLDS[0]!.op));
    expect(commitStep).toHaveBeenCalledExactlyOnceWith(FOLDS[0]!.op, undefined);
  });

  it('declines while a partial precrease’s points are still to be clicked', () => {
    act(() => {
      tools.selectTool('precrease');
      tools.setExtent('pinch');
    });
    render(landed(FOLDS[4]!.op, { status: 'incomplete', mode: 'pinch', picked: 0, needed: 1 }, { step: null }));
    focus(null);
    expect(enter().defaultPrevented).toBe(false);
    expect(commitStep).not.toHaveBeenCalled();
  });
});

describe('Enter at each focus', () => {
  const VALLEY = FOLDS[0]!.op;

  it('commits with nothing focused', () => {
    render(landed(VALLEY));
    focus(null);
    expect(enter().defaultPrevented).toBe(true);
    expect(commitStep).toHaveBeenCalledOnce();
  });

  it('commits with a pane focused, as a click on it leaves it', () => {
    render(landed(VALLEY));
    focus(pane());
    expect(enter().defaultPrevented).toBe(true);
    expect(commitStep).toHaveBeenCalledOnce();
  });

  it('commits from the layer controls, and the chip is not pressed', () => {
    render(landed(VALLEY));
    focus(chip());
    expect(enter().defaultPrevented).toBe(true);
    expect(commitStep).toHaveBeenCalledOnce();
  });

  it('commits again after each: one fold per press', () => {
    render(landed(VALLEY));
    focus(pane());
    enter();
    focus(null);
    enter();
    expect(commitStep).toHaveBeenCalledTimes(2);
  });

  it('leaves Enter to a focused text field or select', () => {
    render(landed(VALLEY));
    for (const control of [host.querySelector<HTMLElement>('input')!, host.querySelector<HTMLElement>('select')!]) {
      focus(control);
      // The control's own: nothing taken from the field or the select.
      expect(enter().defaultPrevented).toBe(false);
    }
    expect(commitStep).not.toHaveBeenCalled();
  });

  it('leaves Enter to a focused button, so the button presses itself rather than also committing', () => {
    render(landed(VALLEY));
    focus(button('Swap'));
    expect(enter().defaultPrevented).toBe(false);
    // The window's own commit button commits by its press: the key does not commit a second time.
    focus(button('Valley fold'));
    expect(enter().defaultPrevented).toBe(false);
    expect(commitStep).not.toHaveBeenCalled();
    act(() => button('Valley fold').click());
    expect(commitStep).toHaveBeenCalledOnce();
  });
});


describe('explicit layer-order acceptance', () => {
  function resolution(overrides = {}) {
    return { key: 'decision', inputKey: foldToolInputKey(tools.store.getState()), active: true, required: true,
      waiting: false, searching: false, searched: false, failed: false, index: 0, count: 2, exact: true, canSearch: true,
      step: vi.fn(), search: vi.fn(), stop: vi.fn(), back: vi.fn(), resume: vi.fn(), ...overrides };
  }
  it('opens review when a queued confirmation discovers ambiguity, without committing', () => {
    render(landed(FOLDS[0]!.op, null, { landing: true }));
    focus(null);
    enter();
    const orderResolution = resolution({ active: false });
    render({ ...landed(FOLDS[0]!.op), orderResolution });
    expect(orderResolution.resume).toHaveBeenCalledOnce();
    expect(commitStep).not.toHaveBeenCalled();
  });
  it('leaves the order chooser closed while editing and opens it on confirmation', () => {
    const orderResolution = resolution({ active: false });
    render({ ...landed(FOLDS[0]!.op), orderResolution });
    focus(null);
    expect(orderResolution.resume).not.toHaveBeenCalled();
    enter();
    expect(orderResolution.resume).toHaveBeenCalledOnce();
    expect(commitStep).not.toHaveBeenCalled();
  });
  it.each([true, false])('waits for the order search before confirming (ambiguous: %s)', (ambiguous) => {
    render({ ...landed(FOLDS[0]!.op), orderResolution: resolution({ active: false, required: false, waiting: true }) });
    focus(null);
    enter();
    expect(commitStep).not.toHaveBeenCalled();
    const answer = resolution({ active: false, required: ambiguous, count: ambiguous ? 2 : 1 });
    render({ ...landed(FOLDS[0]!.op), orderResolution: answer });
    expect(answer.resume).toHaveBeenCalledTimes(ambiguous ? 1 : 0);
    expect(commitStep).toHaveBeenCalledTimes(ambiguous ? 0 : 1);
  });
  it('drops pending confirmation if the moving layers change before the order search answers', () => {
    const before = resolution({ active: false, required: false, waiting: true });
    render({ ...landed(FOLDS[0]!.op), orderResolution: before });
    focus(null);
    enter();
    act(() => tools.setSeed({ scope: 'all' }));
    const answer = resolution({ active: false });
    render({ ...landed(FOLDS[0]!.op), orderResolution: answer });
    expect(answer.resume).not.toHaveBeenCalled();
    expect(commitStep).not.toHaveBeenCalled();
  });
  it('does not consume order cycling shortcuts until review is active', () => {
    const orderResolution = resolution({ active: false });
    render({ ...landed(FOLDS[0]!.op), orderResolution });
    focus(null);
    act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
    expect(orderResolution.step).not.toHaveBeenCalled();
  });
  it('accepts the first order explicitly, once, and rejects stale input and loading', () => {
    const ready = { ...landed(FOLDS[0]!.op), landed: {} as NonNullable<FoldToolPreview['landed']> };
    render({ ...ready, orderResolution: resolution({ waiting: true }) });
    act(() => button('Use this order').click());
    expect(commitStep).not.toHaveBeenCalled();
    render({ ...ready, orderResolution: resolution({ inputKey: 'obsolete' }) });
    act(() => button('Use this order').click());
    expect(commitStep).not.toHaveBeenCalled();
    render({ ...ready, orderResolution: resolution() });
    act(() => { button('Use this order').click(); button('Use this order').click(); });
    expect(commitStep).toHaveBeenCalledOnce();
  });
});

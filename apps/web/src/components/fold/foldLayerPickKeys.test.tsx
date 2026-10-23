import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import type { FoldCrossSection } from '../../fold/engine/foldEngineWire';
import { registerFoldCanvasVerbs } from '../../fold/canvas/foldCanvasCommands';
import { runFoldCanvasShortcut } from '../../fold/canvas/useFoldCanvasShortcuts';
import type { FoldCanvasVerbs } from '../../fold/canvas/useFoldCanvasVerbs';
import { registerFoldKeyHandler, runFoldKey } from '../../fold/sequence/foldKeys';
import { foldFlapChips, foldSectionPicker, type FoldSeedView } from '../../fold/tools/crossSection';
import { registerConditionalScopeExecutor } from '../../keyboard/shortcutRuntime';
import { installAppKeyboardListener } from '../../lib/appKeyboard';
import type { Selection } from '../../lib/sampleProject';
import { FoldCrossSectionPicker } from './FoldCrossSectionPicker';
import { FoldFlapChips } from './FoldFlapChips';

/**
 * The tool window's layer controls under the keys a press really takes: the
 * app's document listener, Fold's scope executor and the canvas's handler —
 * the tool window says "Pick which layers move", then "Press Enter to fold",
 * and the controls the first step leaves focused must not swallow the second.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t.bind(i18n);

const section = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [
    { faces: [1], witness: [0.2, 0.7] },
    { faces: [0], witness: [0.2, 0.2] },
  ],
  rows: [
    { faces: [1], spans: [[0, 1]], flap: 0 },
    { faces: [0], spans: [[0, 1]], flap: 1 },
  ],
  intervals: [{ start: 0, end: 1, faces: [1, 0], rows: [0, 1] }],
  order: { kind: 'layered', unordered: [] },
  layers: 2,
  joins: [],
} as unknown as FoldCrossSection;

const SEED: FoldSeedView = { picked: new Set([0, 1]), added: new Set(), needed: new Set() };

function verbs(): FoldCanvasVerbs {
  return {
    selectTool: vi.fn(),
    selectLineMode: vi.fn(),
    setFreeLineSnap: vi.fn(),
    turn: vi.fn(),
    hitTest: vi.fn(),
    pick: vi.fn(),
    swapSide: vi.fn(() => true),
    toggleFlap: vi.fn(),
    hoverFlap: vi.fn(),
    includeFlaps: vi.fn(),
    foldOtherWay: vi.fn(),
    pickFlap: vi.fn(),
    useLine: vi.fn(),
    stepChoice: vi.fn(() => false),
    setReverseKind: vi.fn(),
    stepOpening: vi.fn(),
    stepOrder: vi.fn(),
    setSecondLineMode: vi.fn(),
    setTuckDirection: vi.fn(),
    stepTuckTarget: vi.fn(),
    toggleTuckPinned: vi.fn(),
    tuckTarget: vi.fn(),
    setVertexDirection: vi.fn(),
    setSwivelKind: vi.fn(),
    setSwivelInput: vi.fn(),
    setSquashHinge: vi.fn(),
    vertexOtherWay: vi.fn(),
    stepEmergent: vi.fn(),
    takeEmergent: vi.fn(),
    stepFanLayers: vi.fn(),
    resetSquashTarget: vi.fn(),
    setVertexLineBy: vi.fn(),
    precreaseLine: vi.fn(),
    precreaseKite: vi.fn(),
    petalByEnds: vi.fn(),
    otherSink: vi.fn(),
    stepPocket: vi.fn(),
    setExtent: vi.fn(),
    cycleExtent: vi.fn(() => false),
    useWholeLine: vi.fn(),
    pinchInstead: vi.fn(),
    throughAllLayers: vi.fn(),
    useMovingPoint: vi.fn(),
    useNarrowerSeed: vi.fn(),
    commit: vi.fn(() => true),
    cancel: vi.fn(() => true),
    clearMarks: vi.fn(),
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const releases: (() => void)[] = [];
let bound: FoldCanvasVerbs;
let onToggle = vi.fn<(flap: number) => void>();

beforeEach(() => {
  // What Fold has mounted while the canvas is up: the app's listener, the
  // panel's executor for the `fold` scope, the canvas's keys.
  releases.push(
    installAppKeyboardListener({
      getActiveEditingContext: () => 'fold',
      getSelection: () => ({ nodes: [], edges: [] }) as unknown as Selection,
      handleMenuAction: () => undefined,
      selectNone: () => undefined,
    }),
    registerConditionalScopeExecutor('fold', runFoldKey)
  );
  bound = verbs();
  releases.push(
    registerFoldCanvasVerbs(bound),
    registerFoldKeyHandler((id) => runFoldCanvasShortcut(id, document.activeElement))
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onToggle = vi.fn<(flap: number) => void>();
  act(() =>
    root?.render(
      <>
        <FoldCrossSectionPicker model={foldSectionPicker(t, section, SEED)} onToggle={onToggle} />
        <FoldFlapChips chips={foldFlapChips(t, section, SEED)} onToggle={onToggle} />
      </>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  for (const release of releases.splice(0).reverse()) release();
});

/** A key pressed on the focused element, as the browser sends it; the event, to read what became of it. */
function press(key: string): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const row = () => host!.querySelector<HTMLElement>('[role="option"]')!;
const chip = () => host!.querySelector<HTMLButtonElement>('[role="group"] button')!;

describe('Enter in the layer controls', () => {
  it('commits from a focused row', () => {
    act(() => row().focus());
    const enter = press('Enter');
    expect(bound.commit).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('commits from a focused chip, and the chip is not pressed', () => {
    act(() => chip().focus());
    const enter = press('Enter');
    expect(bound.commit).toHaveBeenCalledTimes(1);
    // A button's Enter is its keydown's default: prevented, it does not press.
    expect(enter.defaultPrevented).toBe(true);
  });

  it('is kept from a chip while there is nothing to commit yet', () => {
    vi.mocked(bound.commit).mockReturnValue(false);
    act(() => chip().focus());
    const enter = press('Enter');
    expect(bound.commit).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
  });
});

describe('Space in the layer controls', () => {
  it('picks a focused row’s flap', () => {
    act(() => row().focus());
    const space = press(' ');
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(0);
    // The row's own: prevented by the row, so the listbox does not scroll.
    expect(space.defaultPrevented).toBe(true);
  });

  it('is left to a focused chip, which a button presses on Space', () => {
    act(() => chip().focus());
    const space = press(' ');
    expect(space.defaultPrevented).toBe(false);
  });
});

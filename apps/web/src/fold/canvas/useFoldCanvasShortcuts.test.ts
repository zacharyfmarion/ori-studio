import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleShortcutRuntimeKeyDown, registerConditionalScopeExecutor } from '../../keyboard/shortcutRuntime';
import { getResolvedShortcuts, shortcutLabelForAction, SHORTCUT_DEFINITIONS } from '../../keyboard/shortcuts';
import { FOLD_LINE_MODE_SHORTCUTS, FOLD_TOOL_SHORTCUTS } from '../tools/foldToolCatalog';
import { registerFoldKeyHandler, runFoldKey } from '../sequence/foldKeys';
import { registerFoldCanvasVerbs } from './foldCanvasCommands';
import type { FoldCanvasVerbs } from './useFoldCanvasVerbs';
import { focusLeavesEnterToFold, runFoldCanvasShortcut } from './useFoldCanvasShortcuts';

function verbs(roots = 1, extents = true): FoldCanvasVerbs {
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
    stepChoice: vi.fn(() => roots > 1),
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
    cycleExtent: vi.fn(() => extents),
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

let release: (() => void) | null = null;
afterEach(() => {
  release?.();
  release = null;
  document.body.replaceChildren();
});

describe('the Fold canvas’s keys', () => {
  it('declines every key while no canvas is mounted', () => {
    expect(runFoldCanvasShortcut('fold.toolValley', null)).toBe(false);
  });

  it('takes a tool, a line mode and a model verb by their keys', () => {
    const bound = verbs();
    release = registerFoldCanvasVerbs(bound);
    expect(runFoldCanvasShortcut('fold.toolMountain', null)).toBe(true);
    expect(bound.selectTool).toHaveBeenCalledWith('mountain');
    expect(runFoldCanvasShortcut('fold.lineAxiom5', null)).toBe(true);
    expect(bound.selectLineMode).toHaveBeenCalledWith('axiom-5');
    expect(runFoldCanvasShortcut('fold.turnOver', null)).toBe(true);
    expect(bound.turn).toHaveBeenCalledWith({ kind: 'turn-over', axis: 'vertical' });
    // The reverse fold is a tool like the others now.
    expect(runFoldCanvasShortcut('fold.toolInsideReverse', null)).toBe(true);
    expect(bound.selectTool).toHaveBeenCalledWith('inside-reverse');
  });

  it('swaps the side on X only while there is one to swap', () => {
    const bound = verbs();
    release = registerFoldCanvasVerbs(bound);
    expect(runFoldCanvasShortcut('fold.swapSide', null)).toBe(true);
    vi.mocked(bound.swapSide).mockReturnValue(false);
    expect(runFoldCanvasShortcut('fold.swapSide', null)).toBe(false);
  });

  it('steps the precrease extent on E only with the Precrease tool in hand', () => {
    const bound = verbs(1, true);
    release = registerFoldCanvasVerbs(bound);
    expect(runFoldCanvasShortcut('fold.cycleExtent', null)).toBe(true);
    expect(bound.cycleExtent).toHaveBeenCalledTimes(1);
    vi.mocked(bound.cycleExtent).mockReturnValue(false);
    expect(runFoldCanvasShortcut('fold.cycleExtent', null)).toBe(false);
    // E is bound in the fold scope alone, by default.
    const extent = SHORTCUT_DEFINITIONS.find((definition) => definition.id === 'fold.cycleExtent');
    expect(extent).toMatchObject({ scope: 'fold', defaultChord: { key: 'e' } });
  });

  it('commits on Enter unless a focused control owns it', () => {
    const bound = verbs();
    release = registerFoldCanvasVerbs(bound);
    const pane = document.createElement('div');
    pane.setAttribute('data-fold-pane', 'folded');
    const button = document.createElement('button');
    document.body.append(pane, button);
    expect(focusLeavesEnterToFold(document.body)).toBe(true);
    expect(focusLeavesEnterToFold(pane)).toBe(true);
    expect(focusLeavesEnterToFold(button)).toBe(false);
    expect(runFoldCanvasShortcut('fold.commit', button)).toBe(false);
    expect(runFoldCanvasShortcut('fold.commit', pane)).toBe(true);
    expect(bound.commit).toHaveBeenCalledTimes(1);
  });

  it('commits on Enter from the layer controls, and keeps Enter there while there is nothing to commit', () => {
    const bound = verbs();
    release = registerFoldCanvasVerbs(bound);
    const layers = document.createElement('div');
    layers.setAttribute('data-fold-layer-pick', '');
    const chip = document.createElement('button');
    layers.append(chip);
    document.body.append(layers);
    expect(focusLeavesEnterToFold(chip)).toBe(true);
    expect(runFoldCanvasShortcut('fold.commit', chip)).toBe(true);
    expect(bound.commit).toHaveBeenCalledTimes(1);
    // Still landing, or refused: claimed all the same, or the chip's own Enter would press it.
    vi.mocked(bound.commit).mockReturnValue(false);
    expect(runFoldCanvasShortcut('fold.commit', chip)).toBe(true);
    // Off the layer controls a declined commit lets the key go.
    expect(runFoldCanvasShortcut('fold.commit', document.body)).toBe(false);
  });

  it('steps the chooser on Shift+arrows while it has several, and leaves the keys to a control that uses them', () => {
    const one = verbs(1);
    release = registerFoldCanvasVerbs(one);
    expect(runFoldCanvasShortcut('fold.nextCandidate', null)).toBe(false);
    release();
    const two = verbs(2);
    release = registerFoldCanvasVerbs(two);
    expect(runFoldCanvasShortcut('fold.previousCandidate', null)).toBe(true);
    expect(two.stepChoice).toHaveBeenCalledWith(-1);
    const tabs = document.createElement('div');
    tabs.setAttribute('role', 'tablist');
    document.body.append(tabs);
    expect(runFoldCanvasShortcut('fold.nextCandidate', tabs)).toBe(false);
  });

  it('binds the tool rows in the fold scope, one chord each', () => {
    const rows = SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === 'fold');
    const chords = rows.flatMap((row) => getResolvedShortcuts(row.id).map((chord) => JSON.stringify(chord)));
    expect(new Set(chords).size).toBe(chords.length);
    expect(getResolvedShortcuts('fold.lineFree')).toEqual([{ key: 'z' }]);
    expect(getResolvedShortcuts('fold.commit')).toEqual([{ key: 'enter' }]);
  });

  it('gives every rail tool, line mode and sequence verb a key under the left hand', () => {
    const key = (id: Parameters<typeof shortcutLabelForAction>[0]) => shortcutLabelForAction(id);
    // The folds, in the rail's order: A valley, S mountain; D precrease.
    expect([key('fold.toolValley'), key('fold.toolMountain'), key('fold.toolPrecrease')]).toEqual(['A', 'S', 'D']);
    expect(
      Object.fromEntries(
        (
          [
            'fold.toolInsideReverse',
            'fold.toolSquash',
            'fold.toolPleat',
            'fold.toolSwivel',
            'fold.toolCrimp',
            'fold.toolPetal',
            'fold.toolRabbitEar',
            'fold.toolDivideLine',
            'fold.toolOpenSink',
            'fold.toolClosedSink',
            'fold.toolUnsink',
            'fold.rotate',
            'fold.turnOver',
            'fold.lineFree',
            'fold.lineCrease',
            'fold.swapSide',
            'fold.cycleExtent',
            'fold.toolUnfoldTo',
            'fold.toolRepeat',
          ] as const
        ).map((id) => [id, key(id)])
      )
    ).toEqual({
      'fold.toolInsideReverse': 'F',
      'fold.toolSquash': 'G',
      'fold.toolPleat': 'Q',
      'fold.toolSwivel': 'W',
      'fold.toolCrimp': 'Shift+F',
      'fold.toolPetal': 'Shift+G',
      'fold.toolRabbitEar': 'B',
      'fold.toolDivideLine': 'V',
      'fold.toolOpenSink': 'Shift+Z',
      'fold.toolClosedSink': 'Shift+X',
      'fold.toolUnsink': 'Shift+C',
      'fold.rotate': 'R',
      'fold.turnOver': 'T',
      'fold.lineFree': 'Z',
      'fold.lineCrease': 'C',
      'fold.swapSide': 'X',
      'fold.cycleExtent': 'E',
      'fold.toolUnfoldTo': 'Shift+E',
      'fold.toolRepeat': 'Shift+R',
    });
    // Every tool and line mode on the rail has a key.
    for (const id of [...Object.values(FOLD_TOOL_SHORTCUTS), ...Object.values(FOLD_LINE_MODE_SHORTCUTS)]) {
      expect(getResolvedShortcuts(id), id).not.toEqual([]);
    }
  });
});

describe('the fold scope’s shared executor', () => {
  const press = (key: string) =>
    handleShortcutRuntimeKeyDown(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }), {
      context: { activeEditingContext: 'fold' },
      menu: () => undefined,
    });

  it('asks every Fold surface’s handler in turn, a second never replacing the first', () => {
    // The Fold panel's executor, as `useFoldKeyboard` registers it.
    const offScope = registerConditionalScopeExecutor('fold', runFoldKey);
    const tools = vi.fn((id: string) => id === 'fold.toolValley');
    const steps = vi.fn((id: string) => id === 'fold.commit');
    const offTools = registerFoldKeyHandler(tools);
    const offSteps = registerFoldKeyHandler(steps);
    expect(press('a')).toBe(true);
    expect(tools).toHaveBeenCalledWith('fold.toolValley');
    expect(press('Enter')).toBe(true);
    expect(steps).toHaveBeenCalledWith('fold.commit');
    offTools();
    // The other surface still has the keyboard.
    expect(press('Enter')).toBe(true);
    offSteps();
    // With none left to claim it, the key falls through.
    expect(press('a')).toBe(false);
    offScope();
  });
});

it('routes ordinary left/right to an active order decision before timeline handlers', () => {
  const bound = verbs(2);
  bound.choosingOrder = () => true;
  release = registerFoldCanvasVerbs(bound);
  const timeline = vi.fn(() => true);
  const unbind = registerFoldKeyHandler(timeline);
  try {
    expect(runFoldKey('fold.nextStep')).toBe(true);
    expect(bound.stepChoice).toHaveBeenCalledWith(1);
    expect(timeline).not.toHaveBeenCalled();
    bound.choosingOrder = () => false;
    expect(runFoldKey('fold.previousStep')).toBe(true);
    expect(timeline).toHaveBeenCalledExactlyOnceWith('fold.previousStep');
  } finally { unbind(); }
});

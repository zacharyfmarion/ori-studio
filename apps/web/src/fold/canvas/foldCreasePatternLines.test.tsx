import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, ptToDevicePx, type PaperStyle } from '../../lib/paper/paperStyle';
import type { StrokeGeometry } from '../../cp-workspace/renderer/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { FoldScene, FoldSceneCrease } from '../engine/foldEngineWire';
import { bookScene } from './foldCanvas.fixtures';
import { creasePatternPaneLines, type FoldCreasePatternLines } from './foldCreasePatternLines';
import { FOLD_PANE_DISPLAY_DEFAULT } from './foldPaneScenes';
import {
  foldPaneStrokeWidthPx,
  useFoldCreasePatternStrokes,
  type FoldCreasePatternStrokes,
} from './useFoldCreasePatternStrokes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The book, with a precrease across it that remembers a mountain, made at step 1 too. */
function bookWithPrecrease(): FoldScene {
  const scene = bookScene();
  const precrease: FoldSceneCrease = {
    id: 7,
    vertices: [0, 3],
    from: { x: 0, y: 0 },
    to: { x: 1, y: 1 },
    kind: 'flat',
    letter: 'mountain',
    made_at: 0,
  };
  return { ...scene, creases: [...scene.creases, precrease] };
}

describe('the crease-pattern pane in Edit’s vocabulary', () => {
  it('holds each crease as the line Edit would: the border black, folds by letter, a precrease an auxiliary line', () => {
    const lines = creasePatternPaneLines(bookWithPrecrease(), {
      display: { ...FOLD_PANE_DISPLAY_DEFAULT, stepCreases: false },
      step: 1,
      instruction: null,
    });
    expect(lines.instruction).toEqual([]);
    // Flat creases under the folds, the border over both.
    expect(lines.creases.map((line) => line.color)).toEqual(['Cyan3', 'Blue2', ...Array(6).fill('Black0')]);
    // As Send to Edit lands it: an auxiliary line, with no letter to show.
    expect(lines.creases[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, color: 'Cyan3' });
    // In the pane's model space: sheet units, as the engine gives them.
    expect(lines.creases[1]).toMatchObject({ a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 } });
  });

  it('keeps the step’s own creases, or a previewed fold’s, apart as the instruction', () => {
    const own = creasePatternPaneLines(bookScene(), { display: FOLD_PANE_DISPLAY_DEFAULT, step: 1, instruction: null });
    expect(own.instruction).toEqual([{ a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 }, letter: 'valley' }]);
    expect(own.creases.map((line) => line.color)).not.toContain('Blue2');
    // A previewed fold's added creases take the step's place.
    const previewed = creasePatternPaneLines(bookScene(), {
      display: FOLD_PANE_DISPLAY_DEFAULT,
      step: 1,
      instruction: new Set([3]),
    });
    expect(previewed.instruction).toHaveLength(0);
    expect(previewed.creases.map((line) => line.color)).toContain('Blue2');
  });

  it('leaves the precreases out when Precreases is off', () => {
    const lines = creasePatternPaneLines(bookWithPrecrease(), {
      display: { stepCreases: true, precreases: false },
      step: 2,
      instruction: null,
    });
    expect(lines.creases.map((line) => line.color)).not.toContain('Cyan3');
  });

  it('draws a crease mark as an auxiliary line, as a precrease is, and the step’s or a preview’s as the instruction', () => {
    const scene: FoldScene = {
      ...bookScene(),
      crease_marks: [
        { from: { x: 0.25, y: 0.45 }, to: { x: 0.25, y: 0.55 }, letter: 'mountain', made_at: 2, pieces: [] },
        { from: { x: 0.75, y: 0.45 }, to: { x: 0.75, y: 0.55 }, letter: 'valley', made_at: 2, pieces: [] },
      ],
    };
    // At a later step: two auxiliary lines whatever their letters, under the folds and the border.
    const later = creasePatternPaneLines(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, step: 3, instruction: null });
    expect(later.creases.filter((line) => line.color === 'Cyan3')).toEqual([
      { a: { x: 0.25, y: 0.45 }, b: { x: 0.25, y: 0.55 }, color: 'Cyan3' },
      { a: { x: 0.75, y: 0.45 }, b: { x: 0.75, y: 0.55 }, color: 'Cyan3' },
    ]);
    expect(later.creases.map((line) => line.color).slice(0, 3)).toEqual(['Cyan3', 'Cyan3', 'Blue2']);
    expect(later.creases.map((line) => line.color)).not.toContain('Red1');
    expect(later.creases.map((line) => line.color).slice(-6)).toEqual(Array(6).fill('Black0'));
    // The step that made them: its instruction, by letter.
    const own = creasePatternPaneLines(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, step: 2, instruction: null });
    expect(own.instruction.map((line) => line.letter)).toEqual(['mountain', 'valley']);
    // A previewed pinch that adds no crease: its marks are still the instruction.
    const previewed = creasePatternPaneLines(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, step: 2, instruction: new Set() });
    expect(previewed.instruction).toHaveLength(2);
    // Precreases off: a mark is a precrease of part of its line.
    const off = creasePatternPaneLines(scene, { display: { stepCreases: true, precreases: false }, step: 3, instruction: null });
    expect(off.creases.map((line) => line.color)).not.toContain('Cyan3');
  });
});

describe('the pane’s strokes in the paper pens', () => {
  let root: Root;
  let host: HTMLDivElement;
  let latest: FoldCreasePatternStrokes | null = null;
  const pen = (color: string, width: number, dash: number[] | null) => ({ color, width, dash, cap: 'butt' as const });
  const style: PaperStyle = {
    ...DEFAULT_PAPER_STYLE,
    edges: pen('#123456', 0.75, null),
    mountainFolds: pen('#aa1100', 1.5, [8, 2, 1, 2]),
    valleyFolds: pen('#0011aa', 0.375, [4, 2]),
    auxCreases: { visible: true, pen: pen('#117733', 0.25, [1, 2]) },
    mountainDiagramCreases: pen('#aa44aa', 2.25, [6, 2, 1, 2]),
    valleyDiagramCreases: pen('#aa7700', 3, [3, 2]),
  };
  const a = { x: 0.2, y: 0.1 };
  const b = { x: 0.7, y: 0.8 };
  const lines: FoldCreasePatternLines = {
    creases: ['Red1', 'Blue2', 'Cyan3', 'Black0'].map((color) => ({ a, b, color })),
    instruction: [{ a, b, letter: 'mountain' }, { a: b, b: a, letter: 'valley' }],
  };

  function Probe({ paper = style, side = 'front' }: { paper?: PaperStyle; side?: 'front' | 'back' }) {
    latest = useFoldCreasePatternStrokes(lines, paper, side);
    return null;
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    latest = null;
  });

  const rgb = (color: Float32Array, at: number) =>
    [0, 1, 2].map((k) => Math.round((color[at * 4 + k] ?? 0) * 255).toString(16).padStart(2, '0')).join('');
  const dash = (strokes: StrokeGeometry, at: number) =>
    strokes.dashPatterns?.[(strokes.dashSlot?.[at] ?? 0) - 1] ?? null;

  it('uses each paper pen’s color, point width and centered dashes, including step and preview instructions', () => {
    act(() => root.render(<Probe />));
    const { creases, instruction } = latest!;
    expect([0, 1, 2, 3].map((k) => rgb(creases.color, k))).toEqual(['aa1100', '0011aa', '117733', '123456']);
    expect([...creases.widthMul]).toEqual([1.5, 0.375, 0.25, 0.75]);
    // Dash lengths are screen CSS px, centered with half the first run at either end.
    expect(dash(creases, 0)).toEqual([8, 4, 2, 4, 8, 0]);
    expect(dash(creases, 1)).toEqual([1, 1, 1, 0]);
    expect(dash(creases, 3)).toBeNull();
    expect(creases.dashPhase?.[0]).toBeCloseTo(-Math.hypot(b.x - a.x, b.y - a.y) / 2);
    expect([0, 1].map((k) => rgb(instruction!.color, k))).toEqual(['aa44aa', 'aa7700']);
    expect([...instruction!.widthMul]).toEqual([2.25, 3]);
    expect(dash(instruction!, 0)).toEqual([9, 6, 3, 6, 9, 0]);
    expect(dash(instruction!, 1)).toEqual([6, 8, 6, 0]);
  });

  it('swaps full mountain and valley pens on the back and restores them without changing the source', () => {
    const saved = JSON.stringify(lines);
    act(() => root.render(<Probe />));
    const front = latest!;
    act(() => root.render(<Probe side="back" />));
    const back = latest!;
    expect([0, 1, 2, 3].map((k) => rgb(back.creases.color, k))).toEqual(['0011aa', 'aa1100', '117733', '123456']);
    expect([...back.creases.widthMul]).toEqual([0.375, 1.5, 0.25, 0.75]);
    expect(dash(back.creases, 0)).toEqual(dash(front.creases, 1));
    expect(dash(back.creases, 1)).toEqual(dash(front.creases, 0));
    expect([0, 1].map((k) => rgb(back.instruction!.color, k))).toEqual(['aa7700', 'aa44aa']);
    expect([...back.instruction!.widthMul]).toEqual([3, 2.25]);
    expect(dash(back.instruction!, 0)).toEqual(dash(front.instruction!, 1));
    expect(dash(back.instruction!, 1)).toEqual(dash(front.instruction!, 0));
    expect(back.creases.a).toEqual(front.creases.a);
    expect(back.creases.b).toEqual(front.creases.b);
    expect(JSON.stringify(lines)).toBe(saved);
    act(() => root.render(<Probe />));
    expect(latest).toEqual(front);
  });

  it('follows paper style changes and auxiliary visibility independently of Edit’s settings', () => {
    act(() => root.render(<Probe />));
    const front = latest;
    act(() => useWorkspaceStore.setState((state) => ({
      oristudioCpViewport: { ...state.oristudioCpViewport, lineStyle: 'black-one-dot', lineWidth: 6 },
    })));
    act(() => root.render(<Probe />));
    expect(latest).toBe(front);
    act(() => root.render(<Probe paper={{
      ...style,
      mountainFolds: pen('#004411', 4, null),
      auxCreases: { ...style.auxCreases, visible: false },
    }} />));
    expect(latest!.creases.count).toBe(3);
    expect(rgb(latest!.creases.color, 0)).toBe('004411');
    expect(latest!.creases.widthMul[0]).toBe(4);
    expect(dash(latest!.creases, 0)).toBeNull();
  });

  it('keeps physical pen widths constant through zoom and scales them for display density', () => {
    act(() => root.render(<Probe />));
    for (const ratio of [1, 2]) {
      for (const widthBoost of [0.8, 1, 2]) {
        const unit = foldPaneStrokeWidthPx(latest!, { ratio, widthBoost });
        expect(unit * latest!.creases.widthMul[0]!).toBeCloseTo(ptToDevicePx(style.mountainFolds.width, ratio));
        expect(unit * latest!.instruction!.widthMul[0]!).toBeCloseTo(ptToDevicePx(style.mountainDiagramCreases.width, ratio));
      }
    }
  });
});

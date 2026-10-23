import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpCreaseStrokeWidthPx, cpSizingScales } from '../../cp-workspace/cpSizingScales';
import { SOLID_DASH_SLOT } from '../../lib/oristudioCpLineStyle';
import { CP_CREASE_WIDTH_FACTOR } from '../../lib/stepDiagram/diagramInk';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { FoldScene, FoldSceneCrease } from '../engine/foldEngineWire';
import { bookScene } from './foldCanvas.fixtures';
import { creasePatternPaneLines, type FoldCreasePatternLines } from './foldCreasePatternLines';
import { FOLD_PANE_DISPLAY_DEFAULT } from './foldPaneScenes';
import {
  FOLD_INSTRUCTION_WIDTH_MUL,
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

describe('the pane’s strokes, through Edit’s renderer path', () => {
  let root: Root;
  let host: HTMLDivElement;
  let themed: HTMLDivElement;
  let latest: FoldCreasePatternStrokes | null = null;

  function Probe({ lines }: { lines: FoldCreasePatternLines }) {
    latest = useFoldCreasePatternStrokes(lines, themed, 'theme');
    return null;
  }

  beforeEach(() => {
    themed = document.createElement('div');
    themed.style.setProperty('--fold-border', '#111417');
    themed.style.setProperty('--fold-mountain', '#ff4d5d');
    themed.style.setProperty('--fold-valley', '#60a5fa');
    themed.style.setProperty('--fold-unassigned', '#9aa4ad');
    themed.style.setProperty('--fold-flat', '#64c8c8');
    document.body.append(themed);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    themed.remove();
    latest = null;
  });

  const rgb = (color: Float32Array, at: number) =>
    [0, 1, 2].map((k) => Math.round((color[at * 4 + k] ?? 0) * 255).toString(16).padStart(2, '0')).join('');

  it('inks the pattern as Edit does and draws the instruction solid in its crease colour, wider', () => {
    const lines = creasePatternPaneLines(bookWithPrecrease(), {
      display: FOLD_PANE_DISPLAY_DEFAULT,
      step: 1,
      instruction: null,
    });
    act(() => root.render(<Probe lines={lines} />));
    const strokes = latest!;
    // Edit's default line width.
    expect(strokes.lineWidth).toBe(1);
    // The precrease in Edit's auxiliary ink, solid, as Edit draws an aux line; the border in Edit's ink.
    expect(rgb(strokes.creases.color, 0)).toBe('64c8c8');
    expect(strokes.creases.dashSlot?.[0]).toBe(SOLID_DASH_SLOT);
    expect(rgb(strokes.creases.color, 1)).toBe('111417');
    // No second stroke for a letter: the precrease and the six edges of the border, and nothing else.
    expect(strokes.creases.count).toBe(7);
    expect([...Array(strokes.creases.count).keys()].map((at) => rgb(strokes.creases.color, at))).not.toContain('ff4d5d');
    // The step's valley: the tool's line, solid, in the valley colour.
    const instruction = strokes.instruction!;
    expect(instruction.count).toBe(1);
    expect(rgb(instruction.color, 0)).toBe('60a5fa');
    expect(instruction.dashSlot?.[0]).toBe(0);
    expect(instruction.widthMul[0]).toBe(FOLD_INSTRUCTION_WIDTH_MUL);
  });

  it('follows the line style and width Edit’s view is set to', () => {
    useWorkspaceStore.setState((state) => ({
      oristudioCpViewport: { ...state.oristudioCpViewport, lineStyle: 'black-one-dot', lineWidth: 2 },
    }));
    const lines = creasePatternPaneLines(bookScene(), {
      display: { ...FOLD_PANE_DISPLAY_DEFAULT, stepCreases: false },
      step: 1,
      instruction: null,
    });
    act(() => root.render(<Probe lines={lines} />));
    const strokes = latest!;
    expect(strokes.lineWidth).toBe(2);
    // The valley fold, in the monochrome style's ink and its valley dash.
    expect(rgb(strokes.creases.color, 0)).toBe('111417');
    expect(strokes.creases.dashSlot?.[0]).not.toBe(0);
    expect(strokes.instruction).toBeNull();
  });

  it('strokes a crease as wide as Edit’s canvas does at the same zoom, and the step’s own at twice that', () => {
    useWorkspaceStore.setState((state) => ({
      oristudioCpViewport: { ...state.oristudioCpViewport, lineWidth: 1.5 },
    }));
    const lines = creasePatternPaneLines(bookWithPrecrease(), {
      display: FOLD_PANE_DISPLAY_DEFAULT,
      step: 1,
      instruction: null,
    });
    act(() => root.render(<Probe lines={lines} />));
    const strokes = latest!;
    // One frame, sized as both canvases size theirs: a retina display, zoomed in past the fit.
    const ratio = 2;
    const { widthBoost } = cpSizingScales({ camZoom: 8, fitZoom: 2, ratio });
    expect(widthBoost).toBeGreaterThan(1);
    const frame = { ratio, widthBoost };
    // Edit's canvas: its crease width law over the line width its view is set to.
    const edit = cpCreaseStrokeWidthPx(useWorkspaceStore.getState().oristudioCpViewport.lineWidth ?? 1, frame);
    expect(edit).toBeCloseTo(CP_CREASE_WIDTH_FACTOR * 1.5 * ratio * widthBoost, 9);
    // Fold's pane: the same width on its crease channel, every crease of the pattern at 1×...
    const fold = foldPaneStrokeWidthPx(strokes, frame);
    expect(fold).toBe(edit);
    expect([...strokes.creases.widthMul]).toEqual(Array(strokes.creases.count).fill(1));
    // ...and the step's own valley, on the preview channel, at twice Edit's.
    expect(fold * strokes.instruction!.widthMul[0]!).toBe(2 * edit);
  });
});

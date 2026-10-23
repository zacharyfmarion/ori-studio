import { describe, expect, it } from 'vitest';
import { bookScene, flatSquareScene } from '../canvas/foldCanvas.fixtures';
import type { FoldOverlayInks } from '../canvas/foldPaneOverlays';
import { foldPickIndex } from '../canvas/foldPicking';
import { landedPreviewOf } from '../canvas/useFoldToolPreview';
import type { FoldIsometry, FoldStateSummary } from '../engine/foldEngineWire';
import { repeatAxisAt, repeatAxisLines, repeatOverlay, repeatPreviewCreases } from './repeatCanvas';

const summary = (step: number) => ({ step }) as unknown as FoldStateSummary;
/** x ↦ 1 − x: the paper there shown back up. */
const TURNED: FoldIsometry = [-1, 0, 1, 0, 1, 0];
const INKS: FoldOverlayInks = { accent: [0, 0, 1, 1], mark: [0, 0, 0, 1], outline: [1, 1, 1, 1], selection: [1, 0.8, 0.4, 1] };
/** A stroke's colour without its alpha: which ink it is in. */
const ink = (stroke: { color: readonly number[] } | undefined) => stroke?.color.slice(0, 3);
const SHEET: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const VERTICAL = { n: [1, 0] as const, d: 0.5 };
const HORIZONTAL = { n: [0, 1] as const, d: 0.5 };

describe("Repeat's preview on the canvas", () => {
  it('adds the creases made after the step it is folded from, when the engine keeps no summary of it', () => {
    // The book's fold was made at step 1: after the sheet, and not after step 1.
    expect([...landedPreviewOf(summary(1), bookScene(), null, 0).added]).toEqual([6]);
    expect([...landedPreviewOf(summary(1), bookScene(), null, 1).added]).toEqual([]);
    // Without the step it is folded from, the ones made at its own number.
    expect([...landedPreviewOf(summary(1), bookScene(), null).added]).toEqual([6]);
  });

  it('draws each crease it adds where the result puts it, lettered as the step before shows the paper', () => {
    const added = new Set([6]);
    const front = repeatPreviewCreases(bookScene(), added, flatSquareScene());
    expect(front.folded).toEqual([{ line: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], letter: 'valley' }]);
    // The crease pattern draws them as every preview's instruction already.
    expect(front.creasePattern).toEqual([]);
    // The paper there back up before the repeat: the other letter, as a pending fold's line is drawn on it.
    const turned = { ...flatSquareScene(), face_transforms: [TURNED] };
    expect(repeatPreviewCreases(bookScene(), added, turned).folded[0]?.letter).toBe('mountain');
    // The step before not in: as the result shows it.
    expect(repeatPreviewCreases(bookScene(), added, null).folded[0]?.letter).toBe('valley');
    // A crease it did not add is not drawn.
    expect(repeatPreviewCreases(bookScene(), new Set(), flatSquareScene()).folded).toEqual([]);
  });

  it('draws a refused line across the sheet it was drawn on, and none on a pane it was not', () => {
    const line = { n: [1, 0] as const, d: 0.25 };
    const drawn = repeatOverlay(null, SHEET, [], -1, -1, [], { sheet: line, pane: 'crease-pattern', drawn: line }, INKS);
    expect(drawn.folded.strokes).toEqual([]);
    expect(drawn.creasePattern.strokes).toHaveLength(1);
    const [stroke] = drawn.creasePattern.strokes;
    expect([stroke!.a.x, stroke!.b.x]).toEqual([0.25, 0.25]);
    expect([stroke!.a.y, stroke!.b.y].sort()).toEqual([0, 1]);
    // In the pick's accent: a refusal, not an axis.
    expect(ink(stroke)).toEqual([0, 0, 1]);
    // Drawn on the folded pane with nothing indexed there: nothing to draw it across.
    expect(repeatOverlay(null, SHEET, [], -1, -1, [], { sheet: line, pane: 'folded', drawn: line }, INKS).folded.strokes).toEqual([]);
  });

  it('draws every axis across the sheet and through each face it crosses, the taken one brightest and the hovered one brighter', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const overlay = repeatOverlay(index, SHEET, [VERTICAL, HORIZONTAL], 1, 0, [], null, INKS);
    expect(overlay.creasePattern.strokes).toHaveLength(2);
    // The book's two halves, each crossed by both lines: four stretches where the folded form lays them.
    expect(overlay.folded.strokes).toHaveLength(4);
    const alpha = (stroke: { color: readonly number[] }) => stroke.color[3]!;
    // Offered faint, hovered brighter, taken brightest: drawn in that order, the brightest on top.
    const [hovered, taken] = overlay.creasePattern.strokes;
    expect(alpha(taken!)).toBeGreaterThan(alpha(hovered!));
    // Every axis, on both panes and in every state, in Edit's selection colour: never the accent a valley might share.
    const refused = repeatOverlay(index, SHEET, [VERTICAL, HORIZONTAL], -1, -1, [0], null, INKS);
    const strokes = [overlay, refused].flatMap((each) => [...each.creasePattern.strokes, ...each.folded.strokes]);
    expect(strokes.every((each) => ink(each)?.join() === '1,0.8,0.4')).toBe(true);
    const lines = repeatAxisLines(bookScene(), SHEET, VERTICAL);
    expect(lines.folded.every(([a, b]) => Math.abs(a.x - 0.5) < 1e-12 && Math.abs(b.x - 0.5) < 1e-12)).toBe(true);
  });

  it('finds the axis under the pointer: the nearest across the sheet, and on the folded pane the one on the top layer', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const axes = [VERTICAL, HORIZONTAL];
    expect(repeatAxisAt(index, SHEET, axes, 'crease-pattern', { x: 0.52, y: 0.9 }, 0.05)).toBe(0);
    expect(repeatAxisAt(index, SHEET, axes, 'crease-pattern', { x: 0.2, y: 0.2 }, 0.05)).toBe(-1);
    // The right half lies on top, mirrored: the pointer at x = 0.45 is on its paper at x = 0.55.
    expect(repeatAxisAt(index, SHEET, axes, 'folded', { x: 0.45, y: 0.1 }, 0.06)).toBe(0);
    expect(repeatAxisAt(index, SHEET, axes, 'folded', { x: 0.25, y: 0.51 }, 0.05)).toBe(1);
    expect(repeatAxisAt(index, SHEET, axes, 'folded', { x: 0.2, y: 0.2 }, 0.05)).toBe(-1);
  });
});

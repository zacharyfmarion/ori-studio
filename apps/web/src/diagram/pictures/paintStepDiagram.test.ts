import { describe, expect, it } from 'vitest';
import type {
  StepDiagramModel,
  StepDiagramPrimitive,
} from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { referencesStrip } from '../document/referencesSteps.fixtures';
import { STEP_CARD_PADDING_MM, stepScenePage } from './paintDiagramStep';
import { paintStepDiagram, stepDiagramScene, stepDiagramSheetBox, stepDiagramToPicture } from './paintStepDiagram';

const SHEET: StepDiagramPrimitive = { kind: 'sheet', width: 1, height: 1 };

function model(...primitives: StepDiagramPrimitive[]): StepDiagramModel {
  return { sheet: { width: 1, height: 1 }, primitives: [SHEET, ...primitives] };
}

/** A fold with its arrow, the point it lands on, and its letter. */
const FOLD = model(
  { kind: 'line', from: [0, 0], to: [1, 1], style: 'crease' },
  { kind: 'line', from: [0, 1], to: [1, 0], style: 'valley' },
  { kind: 'fold-arrow', out: { center: [0.5, 0.5], radius: 0.4, from: 0.3, to: 1.2, ccw: true } },
  { kind: 'point', at: [0, 1], style: 'action' },
  { kind: 'label', at: [0, 1], text: 'A', style: 'normal' }
);

function paintAt(diagram: StepDiagramModel, mm: number, mirrored = false) {
  return paintStepDiagram(diagram, mirrored, DEFAULT_DIAGRAM_STYLE, {
    ...stepScenePage(STEP_CARD_PADDING_MM),
    sheet: { mm },
  });
}

/** The first `<line>` whose stroke matches, as its attributes. */
function lineAttributes(svg: string, index = 0): Record<string, string> {
  const lines = [...svg.matchAll(/<line ([^>]*)\/>/g)].map((match) =>
    Object.fromEntries([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((pair) => [pair[1]!, pair[2]!]))
  );
  return lines[index]!;
}

describe('paintStepDiagram', () => {
  // The golden of D6: built at the size it is painted at, a step's marks keep
  // their pt size on a card and in a cell twice its size, while the paper
  // grows and every line keeps its pen.
  it('keeps every mark its pt size at two sizes, while the paper doubles', () => {
    const small = paintAt(FOLD, 50);
    const large = paintAt(FOLD, 100);
    const marks = (svg: string) => ({
      scale: /<g transform="translate\([^)]*\) (scale\([^)]*\))">/.exec(svg)?.[1],
      ring: /<circle [^>]*r="([^"]*)"/.exec(svg)?.[1],
      letter: /<text [^>]*font-size="([^"]*)"/.exec(svg)?.[1],
    });
    expect(marks(small.svg)).toEqual({ scale: 'scale(0.75)', ring: expect.any(String), letter: expect.any(String) });
    expect(marks(large.svg)).toEqual(marks(small.svg));
    const edge = (svg: string) => {
      const { x1, x2 } = lineAttributes(svg, 2);
      return Math.abs(Number(x2) - Number(x1));
    };
    expect(edge(large.svg)).toBeCloseTo(edge(small.svg) * 2, 1);
    expect(lineAttributes(large.svg, 1)['stroke-width']).toBe(lineAttributes(small.svg, 1)['stroke-width']);
  });

  it('draws the unit frame y up, as the card does', () => {
    // A valley along the bottom of the sheet is below a mountain along its top.
    const scene = stepDiagramScene(
      model(
        { kind: 'line', from: [0.1, 0.1], to: [0.9, 0.1], style: 'valley' },
        { kind: 'line', from: [0.1, 0.9], to: [0.9, 0.9], style: 'mountain' }
      ),
      false,
      DEFAULT_DIAGRAM_STYLE,
      50
    );
    const y = (role: string) => {
      const line = scene.items.find((item) => item.kind === 'line' && item.role === role);
      return line?.kind === 'line' ? line.a[1] : Number.NaN;
    };
    expect(y('diagram-valley')).toBeGreaterThan(y('diagram-mountain'));
  });

  it('shows the back mirrored about the sheet’s middle, every fold named from that side', () => {
    const valley = model({ kind: 'line', from: [0.2, 0.1], to: [0.2, 0.9], style: 'valley' });
    const front = stepDiagramScene(valley, false, DEFAULT_DIAGRAM_STYLE, 50);
    const back = stepDiagramScene(valley, true, DEFAULT_DIAGRAM_STYLE, 50);
    const fold = (scene: typeof front) =>
      scene.items.find((item) => item.kind === 'line' && item.role !== 'edge');
    const frontFold = fold(front);
    const backFold = fold(back);
    expect(frontFold).toMatchObject({ role: 'diagram-valley' });
    expect(backFold).toMatchObject({ role: 'diagram-mountain' });
    // The same paper, in the same place: reflected about its middle.
    expect(back.bounds).toEqual(front.bounds);
    const middle = (front.bounds.minX + front.bounds.maxX) / 2;
    if (frontFold?.kind !== 'line' || backFold?.kind !== 'line') throw new Error('no fold');
    expect(backFold.a[0] - middle).toBeCloseTo(middle - frontFold.a[0], 6);
    expect(back.items.find((item) => item.kind === 'face')).toMatchObject({ side: 'back' });
  });

  it('puts a model point in picture units where the picture draws it, front and back', () => {
    // A sheet twice as wide as it is tall: its frame is 1 by 0.5.
    const wide: StepDiagramModel = {
      sheet: { width: 1, height: 0.5 },
      primitives: [
        { kind: 'sheet', width: 1, height: 0.5 },
        { kind: 'line', from: [0.2, 0.1], to: [0.7, 0.4], style: 'valley' },
      ],
    };
    const front = stepDiagramToPicture(wide, false);
    const back = stepDiagramToPicture(wide, true);
    // y up in the model, y down in the picture; the back reflects x.
    expect(front([0, 0])).toEqual([0, 0.5]);
    expect(front([1, 0.5])).toEqual([1, 0]);
    expect(back([0, 0])).toEqual([1, 0.5]);
    for (const mirrored of [false, true]) {
      const scene = stepDiagramScene(wide, mirrored, DEFAULT_DIAGRAM_STYLE, 50);
      const box = stepDiagramSheetBox(wide, mirrored, 50);
      const drawn = scene.items.find((item) => item.kind === 'line' && item.role !== 'edge');
      if (drawn?.kind !== 'line') throw new Error('no fold');
      const toPicture = mirrored ? back : front;
      const [u, v] = toPicture([0.2, 0.1]);
      expect(u).toBeCloseTo((drawn.a[0] - box.x) / box.width, 9);
      expect(v).toBeCloseTo((drawn.a[1] - box.y) / box.width, 9);
    }
  });

  it('paints every card of a real plan', () => {
    for (const card of referencesStrip()) {
      const painted = paintAt(card.primitives!, 50, card.mirrored);
      expect(painted.svg).toMatch(/^<\?xml/);
      expect(painted.widthPx).toBeGreaterThan(0);
    }
  });
});

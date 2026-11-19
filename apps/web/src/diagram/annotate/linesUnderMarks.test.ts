import { describe, expect, it } from 'vitest';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import {
  createDiagram,
  type DiagramScenePicture,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import { storedScene } from '../pictures/pictureFrame';
import { storedSceneUnderMarks } from '../pictures/sceneUnderMarks';
import { hidesLinesUnder, linesUnderMarks, markLineCover } from './linesUnderMarks';
import { annotation, FLAT, IN_3D, NO_ASSETS, sceneStep, uploadStep } from './pictureSnap.fixtures';

const style = createDiagram().style;

/**
 * A crease pattern 100 px across, so a scene px is a hundredth of a picture
 * unit: a precrease across its middle, a valley from corner to corner.
 */
const PATTERN_ITEMS = [
  face([SQUARE]),
  line('aux', [0, 50], [100, 50]),
  line('valley', [0, 0], [100, 100]),
  line('edge', [0, 0], [100, 0]),
];

function withMarks(step: DiagramStep, ...marks: KnownDiagramAnnotation[]): DiagramStep {
  return { ...step, annotations: marks };
}

const valleyAlongPrecrease = annotation({ id: 'along', kind: 'valley-line', from: [0, 0.5], to: [1, 0.5] });

describe('linesUnderMarks', () => {
  it('finds a line mark snapped along a line of the picture, in picture units', () => {
    const covering = linesUnderMarks(withMarks(sceneStep(PATTERN_ITEMS), valleyAlongPrecrease), NO_ASSETS, style);
    expect(covering?.lines).toEqual([[[0, 0.5], [1, 0.5]]]);
    expect(covering?.tolerance).toBeGreaterThan(0);
  });

  it('finds one along part of a line, or along the whole of one and past it', () => {
    const half = annotation({ id: 'half', kind: 'mountain-line', from: [0.5, 0.5], to: [1, 1] });
    const past = annotation({ id: 'past', kind: 'hidden-line', from: [-0.2, 0.5], to: [1.2, 0.5] });
    const covering = linesUnderMarks(withMarks(sceneStep(PATTERN_ITEMS), half, past), NO_ASSETS, style);
    expect(covering?.lines).toHaveLength(2);
  });

  it('is null where no line mark lies along a line: one beside it, across one, or only touching its end', () => {
    // Far enough off that the paper shows between the two inks.
    const off = annotation({ id: 'off', kind: 'valley-line', from: [0, 0.51], to: [1, 0.51] });
    const across = annotation({ id: 'across', kind: 'valley-line', from: [0.3, 0], to: [0.3, 1] });
    const onward = annotation({ id: 'onward', kind: 'valley-line', from: [1, 0.5], to: [1.3, 0.5] });
    const step = withMarks(sceneStep(PATTERN_ITEMS), off, across, onward);
    expect(linesUnderMarks(step, NO_ASSETS, style)).toBeNull();
  });

  it('counts every drawn line kind, and no other mark', () => {
    for (const kind of ['valley-line', 'mountain-line', 'hidden-line', 'solid-line', 'uncreased-line'] as const) {
      expect(hidesLinesUnder(annotation({ kind, from: [0, 0.5], to: [1, 0.5] }))).toBe(true);
    }
    const others = (['valley-arrow', 'fold-unfold-arrow', 'divisions', 'callout', 'circle'] as const).map((kind) =>
      annotation({ id: kind, kind, from: [0, 0.5], to: [1, 0.5] })
    );
    expect(linesUnderMarks(withMarks(sceneStep(PATTERN_ITEMS), ...others), NO_ASSETS, style)).toBeNull();
    expect(hidesLinesUnder({ ...valleyAlongPrecrease, hidden: true })).toBe(false);
    expect(hidesLinesUnder({ id: 'newer', unknown: { kind: 'future' } } as never)).toBe(false);
  });

  it('reads a flat fold and a picture taken through a camera alike', () => {
    const alongValley = annotation({ id: 'diagonal', kind: 'valley-line', from: [0, 0], to: [1, 1] });
    for (const render of [FLAT, IN_3D]) {
      const covering = linesUnderMarks(withMarks(sceneStep(PATTERN_ITEMS, render), alongValley), NO_ASSETS, style);
      expect(covering?.lines).toHaveLength(1);
    }
  });

  it('hides an edge under a mark along it, and a side of a face’s own outline in either pen', () => {
    const alongTop = annotation({ id: 'top', kind: 'valley-line', from: [0, 0], to: [1, 0] });
    expect(linesUnderMarks(withMarks(sceneStep(PATTERN_ITEMS), alongTop), NO_ASSETS, style)?.lines).toEqual([
      [[0, 0], [1, 0]],
    ]);
    expect(markLineCover(alongTop, sceneStep(PATTERN_ITEMS), NO_ASSETS, style)).toBe('whole');
    // A flat fold strokes a face's outline itself where its sides share a pen: the edge's, or the precreases'.
    for (const outline of ['edge', 'aux'] as const) {
      const outlined = sceneStep([face([SQUARE], { outline })]);
      expect(linesUnderMarks(withMarks(outlined, alongTop), NO_ASSETS, style)?.lines).toHaveLength(1);
      expect(markLineCover({ ...alongTop, to: [0.5, 0] }, outlined, NO_ASSETS, style)).toBe('part');
    }
  });

  it('never hides anything on an upload', () => {
    const { step, assets } = uploadStep();
    expect(linesUnderMarks(withMarks(step, valleyAlongPrecrease), assets, style)).toBeNull();
  });

  it('puts an enlarged step’s marks, in its window’s units, back in its picture’s', () => {
    // A circle about (0.5, 0.4), radius 0.15: the window is 0.3 across from (0.35, 0.25).
    const enlarged: DiagramStep = {
      ...sceneStep([face([SQUARE]), line('aux', [0, 40], [100, 40])]),
      zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.4], radius: 0.15 } },
    };
    const mark = annotation({ id: 'window', kind: 'valley-line', from: [0, 0.5], to: [1, 0.5] });
    const [only] = linesUnderMarks(withMarks(enlarged, mark), NO_ASSETS, style)?.lines ?? [];
    expect(only?.[0][0]).toBeCloseTo(0.35);
    expect(only?.[0][1]).toBeCloseTo(0.4);
    expect(only?.[1][0]).toBeCloseTo(0.65);
    expect(only?.[1][1]).toBeCloseTo(0.4);
  });

  it('takes each layer’s copy of a line that reads as one with the mark, and leaves one drawn beside it', () => {
    // As the example crane draws them: step 7's precrease copy 0.0003 off at its far end, step 13's
    // flap edges fanning out from a tip to 0.0066 off; a line 0.01 off shows the paper between.
    const step = sceneStep([
      face([SQUARE]),
      line('aux', [50, 0], [50, 100]),
      line('aux', [50.03, 98.75], [50, 0]),
      line('edge', [50, 100], [50.66, 30]),
      line('aux', [51, 0], [51, 100]),
    ]);
    const mark = annotation({ id: 'centre', kind: 'valley-line', from: [0.5, 0], to: [0.5, 1] });
    const covering = linesUnderMarks(withMarks(step, mark), NO_ASSETS, style);
    const left = storedSceneUnderMarks(storedScene(step.picture as DiagramScenePicture)!, covering).items.filter(
      (item) => item.kind === 'line'
    );
    expect(left.map((item) => item.kind === 'line' && item.a)).toEqual([[51, 0]]);
  });

  it('reaches as far off a mark as the style’s pens make a line read as one with it', () => {
    const tolerance = (drawnIn: DiagramStyle) =>
      linesUnderMarks(withMarks(sceneStep(PATTERN_ITEMS), valleyAlongPrecrease), NO_ASSETS, drawnIn)?.tolerance ?? 0;
    // The Diagram style's 0.75 pt fold line and half its 0.5 pt edge, on a 50 mm frame.
    expect(tolerance(style)).toBeCloseTo(0.00706, 4);
    const step = sceneStep([face([SQUARE]), line('aux', [50.9, 0], [50.9, 100])]);
    const mark = annotation({ id: 'centre', kind: 'valley-line', from: [0.5, 0], to: [0.5, 1] });
    expect(markLineCover(mark, step, NO_ASSETS, style)).toBe('none');
    // Fold lines twice as heavy: a line 0.009 off now runs against the mark's ink.
    const drawn = diagramSurfaceStyle(style);
    const heavy: DiagramStyle = {
      style: {
        ...drawn,
        valleyDiagramCreases: { ...drawn.valleyDiagramCreases, width: 1.5 },
        mountainDiagramCreases: { ...drawn.mountainDiagramCreases, width: 1.5 },
      },
    };
    expect(tolerance(heavy)).toBeGreaterThan(0.009);
    expect(markLineCover(mark, step, NO_ASSETS, heavy)).toBe('whole');
  });

  it('says how much of a line a mark takes, as it is put down: all of one, a stretch of one, or none', () => {
    const step = sceneStep(PATTERN_ITEMS);
    const cover = (mark: KnownDiagramAnnotation) => markLineCover(mark, step, NO_ASSETS, style);
    expect(cover(valleyAlongPrecrease)).toBe('whole');
    expect(cover({ ...valleyAlongPrecrease, from: [-0.1, 0.5], to: [1.1, 0.5] })).toBe('whole');
    expect(cover({ ...valleyAlongPrecrease, to: [0.5, 0.5] })).toBe('part');
    // Half the diagonal valley, from its end: a stretch, whatever line kind takes it.
    expect(cover({ ...valleyAlongPrecrease, kind: 'mountain-line', from: [0, 0], to: [0.5, 0.5] })).toBe('part');
    expect(cover({ ...valleyAlongPrecrease, from: [0, 0.51], to: [1, 0.51] })).toBe('none');
    // A mark that hides nothing takes nothing, wherever it lies.
    expect(cover({ ...valleyAlongPrecrease, kind: 'valley-arrow' })).toBe('none');
  });

  it('keys the marks by what they hide: their order and way round are not in it', () => {
    const step = sceneStep(PATTERN_ITEMS);
    const diagonal = annotation({ id: 'diagonal', kind: 'valley-line', from: [0, 0], to: [1, 1] });
    const reversed = { ...valleyAlongPrecrease, from: valleyAlongPrecrease.to, to: valleyAlongPrecrease.from };
    const key = (...marks: KnownDiagramAnnotation[]) => linesUnderMarks(withMarks(step, ...marks), NO_ASSETS, style)?.key;
    expect(key(valleyAlongPrecrease, diagonal)).toBe(key(diagonal, reversed));
    expect(key(valleyAlongPrecrease)).not.toBe(key(valleyAlongPrecrease, diagonal));
  });
});

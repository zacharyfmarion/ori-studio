import { describe, expect, it } from 'vitest';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import {
  createDiagram,
  type DiagramScenePicture,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
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

  it('is null where no line mark lies along a line: one a hair off, across one, or only touching its end', () => {
    const off = annotation({ id: 'off', kind: 'valley-line', from: [0, 0.502], to: [1, 0.502] });
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

  it('hides nothing under a mark along an edge, a face’s edge outline included, and a face’s crease outline under one', () => {
    const alongTop = annotation({ id: 'top', kind: 'valley-line', from: [0, 0], to: [1, 0] });
    expect(linesUnderMarks(withMarks(sceneStep(PATTERN_ITEMS), alongTop), NO_ASSETS, style)).toBeNull();
    expect(markLineCover(alongTop, sceneStep(PATTERN_ITEMS), NO_ASSETS, style)).toBe('none');
    const edged = sceneStep([face([SQUARE], { outline: 'edge' })]);
    expect(linesUnderMarks(withMarks(edged, alongTop), NO_ASSETS, style)).toBeNull();
    // A face a flat fold bounds by precreases alone strokes its outline in their pen: its sides hide.
    const creased = sceneStep([face([SQUARE], { outline: 'aux' })]);
    expect(linesUnderMarks(withMarks(creased, alongTop), NO_ASSETS, style)?.lines).toHaveLength(1);
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

  it('takes a crease’s copy another layer draws a hair off it, and leaves a line drawn beside it', () => {
    // As the example crane's step 7 draws its precrease: a second layer's copy 0.0003 off at its far end.
    const step = sceneStep([
      face([SQUARE]),
      line('aux', [50, 0], [50, 100]),
      line('aux', [50.03, 98.75], [50, 0]),
      line('aux', [50.3, 0], [50.3, 100]),
    ]);
    const mark = annotation({ id: 'centre', kind: 'valley-line', from: [0.5, 0], to: [0.5, 1] });
    const covering = linesUnderMarks(withMarks(step, mark), NO_ASSETS, style);
    const left = storedSceneUnderMarks(storedScene(step.picture as DiagramScenePicture)!, covering).items.filter(
      (item) => item.kind === 'line'
    );
    expect(left.map((item) => item.kind === 'line' && item.a)).toEqual([[50.3, 0]]);
  });

  it('says how much of a line a mark takes, as it is put down: all of one, a stretch of one, or none', () => {
    const step = sceneStep(PATTERN_ITEMS);
    const cover = (mark: KnownDiagramAnnotation) => markLineCover(mark, step, NO_ASSETS, style);
    expect(cover(valleyAlongPrecrease)).toBe('whole');
    expect(cover({ ...valleyAlongPrecrease, from: [-0.1, 0.5], to: [1.1, 0.5] })).toBe('whole');
    expect(cover({ ...valleyAlongPrecrease, to: [0.5, 0.5] })).toBe('part');
    // Half the diagonal valley, from its end: a stretch, whatever line kind takes it.
    expect(cover({ ...valleyAlongPrecrease, kind: 'mountain-line', from: [0, 0], to: [0.5, 0.5] })).toBe('part');
    expect(cover({ ...valleyAlongPrecrease, from: [0, 0.502], to: [1, 0.502] })).toBe('none');
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

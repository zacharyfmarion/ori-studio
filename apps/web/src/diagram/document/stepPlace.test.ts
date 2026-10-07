import { describe, expect, it } from 'vitest';
import {
  createDiagram,
  createStep,
  createTurn,
  duplicateStep,
  insertSteps,
  stepById,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepPlace,
} from './diagramDocument';
import { cpStep } from './diagramSteps.fixtures';
import {
  isPlacedStep,
  normalizeStepPlace,
  patchedStepPlace,
  placementBlocker,
  placeOffset,
  placeScale,
  resetStepPlace,
  resetStepPlaces,
  setStepPlace,
  unplacedDiagram,
} from './stepPlace';

/**
 * A step placed by hand on the printed pages
 * (`implementation-plans/diagram-page-overrides.md`, Phase 1): the record as
 * it is kept, and the edits that set and reset it.
 */

const PLACED: DiagramStepPlace = { frame: [3, -2], number: [1, 0], picture: [0, 4], text: [-1.5, 2], scale: { mmPerUnit: 0.25 } };

function diagram(...steps: DiagramDocument['steps']): DiagramDocument {
  return insertSteps(createDiagram({ title: 'Crane', newId: () => 'diagram-1' }), steps, 0);
}

const placeOf = (document: DiagramDocument, id: string) => stepById(document, id)?.place;

describe('a placement as it is kept', () => {
  it('keeps an offset to a tenth of a mm, and one under 0.05 mm both ways as none', () => {
    expect(placeOffset([1.234, -0.26])).toEqual([1.2, -0.3]);
    expect(placeOffset([0.3, 0])).toEqual([0.3, 0]);
    // Floats a tenth apart come out as the decimals a file writes, never a negative zero.
    expect(placeOffset([0.1 + 0.2, -0.04])).toEqual([0.3, 0]);
    expect(Object.is(placeOffset([-0.04, 1])![0], 0)).toBe(true);
    expect(placeOffset([0.04, -0.049])).toBeNull();
    expect(placeOffset([0, 0])).toBeNull();
  });

  it('reads nothing that is not two finite numbers as an offset', () => {
    for (const value of [[1], [1, 2, 3], [1, '2'], [Infinity, 0], [Number.NaN, 1], { x: 1, y: 2 }, 'far', null]) {
      expect(placeOffset(value)).toBeNull();
    }
  });

  it('keeps a pin of exactly one measure, finite and above zero', () => {
    expect(placeScale({ mmPerUnit: 0.25 })).toEqual({ mmPerUnit: 0.25 });
    expect(placeScale({ frameMm: 48 })).toEqual({ frameMm: 48 });
    for (const value of [{ mmPerUnit: 0 }, { frameMm: -3 }, { frameMm: Infinity }, { mmPerUnit: '2' }, { mmPerUnit: 1, frameMm: 2 }, {}, { printedMm: 40 }, 3, [1]]) {
      expect(placeScale(value)).toBeNull();
    }
  });

  it('is none when nothing is left of it, and lists its fields in the order they are written', () => {
    expect(normalizeStepPlace({ frame: [0, 0], number: [0.01, 0], text: [0, -0.02] })).toBeUndefined();
    expect(normalizeStepPlace({})).toBeUndefined();
    expect(normalizeStepPlace(undefined)).toBeUndefined();
    const shuffled = { scale: { frameMm: 40 }, text: [2, 0], frame: [1.04, 0] } as DiagramStepPlace;
    expect(JSON.stringify(normalizeStepPlace(shuffled))).toBe('{"frame":[1,0],"text":[2,0],"scale":{"frameMm":40}}');
  });

  it('takes a patch field by field: a value set, null cleared, one left out kept, an offset of none cleared', () => {
    const place: DiagramStepPlace = { number: [1, 0], text: [2, 2], scale: { frameMm: 40 } };
    expect(patchedStepPlace(place, { frame: [5, 0], number: null, scale: { mmPerUnit: 0.5 } })).toEqual({
      frame: [5, 0],
      text: [2, 2],
      scale: { mmPerUnit: 0.5 },
    });
    expect(patchedStepPlace(place, { text: [0.02, 0] })).toEqual({ number: [1, 0], scale: { frameMm: 40 } });
    expect(patchedStepPlace({ text: [1, 0] }, { text: null })).toBeUndefined();
    expect(patchedStepPlace(undefined, { picture: [0, 1.26] })).toEqual({ picture: [0, 1.3] });
  });

  it('takes a value that is not one as no change: only null clears a field', () => {
    const place: DiagramStepPlace = { text: [2, 2], scale: { mmPerUnit: 0.3 } };
    for (const scale of [{ mmPerUnit: 0 }, { mmPerUnit: -1 }, { frameMm: Infinity }, { frameMm: Number.NaN }]) {
      expect(patchedStepPlace(place, { scale })).toEqual(place);
    }
    for (const text of [[Number.NaN, 0], [Infinity, 1], [1]] as unknown as [number, number][]) {
      expect(patchedStepPlace(place, { text })).toEqual(place);
    }
    // The rest of the patch still goes through.
    expect(patchedStepPlace(place, { scale: { frameMm: 0 }, number: [1, 0] })).toEqual({ ...place, number: [1, 0] });
    const before = diagram({ ...cpStep('step-1'), place });
    expect(setStepPlace(before, 'step-1', { scale: { mmPerUnit: 0 } })).toBe(before);
  });
});

describe('placing a step', () => {
  it('sets each field, and gives back the same document for a change that changes nothing', () => {
    const before = diagram(cpStep('step-1'), cpStep('step-2'));
    const moved = setStepPlace(before, 'step-2', { frame: [4, 1] });
    expect(placeOf(moved, 'step-2')).toEqual({ frame: [4, 1] });
    expect(stepById(moved, 'step-1')).toBe(stepById(before, 'step-1'));
    // The same offset, or one a hundredth from it, is no edit.
    expect(setStepPlace(moved, 'step-2', { frame: [4.01, 1] })).toBe(moved);
    expect(setStepPlace(before, 'step-2', { text: [0, 0] })).toBe(before);
    expect(setStepPlace(before, 'step-2', { text: null })).toBe(before);
    // Dragged home, the offset is none, and so is the placement.
    const home = setStepPlace(moved, 'step-2', { frame: [0.02, -0.01] });
    expect('place' in stepById(home, 'step-2')!).toBe(false);
  });

  it('changes nothing on a turn, an id not there, a newer build’s step or a newer build’s placement', () => {
    const locked: DiagramStep = { ...createStep(() => 'step-locked'), unknown: { id: 'step-locked', place: { frame: [1, 1] } } };
    const newer: DiagramStep = { ...cpStep('step-newer'), placeNewer: { frame: [1, 1], tilt: 3 } };
    const before = diagram(cpStep('step-1'), createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'), locked, newer);
    for (const id of ['turn-1', 'step-gone', 'step-locked', 'step-newer']) {
      expect(setStepPlace(before, id, { number: [2, 0] })).toBe(before);
      expect(resetStepPlace(before, id, 'frame')).toBe(before);
    }
    expect(placementBlocker(locked)).toBe('locked');
    expect(placementBlocker(newer)).toBe('newer');
    expect(placementBlocker(cpStep('step-1'))).toBeNull();
  });

  it('pins no scale on an enlarged step, whose Size is its pin, and clears one it kept from before', () => {
    const enlarged: DiagramStep = {
      ...cpStep('step-2'),
      zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.5], radius: 0.2 } },
      place: { scale: { mmPerUnit: 0.3 } },
    };
    const before = diagram(cpStep('step-1'), enlarged);
    expect(setStepPlace(before, 'step-2', { scale: { mmPerUnit: 0.4 } })).toBe(before);
    expect(placeOf(setStepPlace(before, 'step-2', { text: [1, 0] }), 'step-2')).toEqual({ text: [1, 0], scale: { mmPerUnit: 0.3 } });
    expect(placeOf(setStepPlace(before, 'step-2', { scale: null }), 'step-2')).toBeUndefined();
  });
});

describe('resetting a placement', () => {
  const placed = () => diagram({ ...cpStep('step-1'), place: PLACED }, cpStep('step-2'));

  it('clears one offset, the pin, every offset, or the lot', () => {
    const document = placed();
    const { frame: _frame, ...noFrame } = PLACED;
    expect(placeOf(resetStepPlace(document, 'step-1', 'frame'), 'step-1')).toEqual(noFrame);
    const { scale: _scale, ...noPin } = PLACED;
    expect(placeOf(resetStepPlace(document, 'step-1', 'scale'), 'step-1')).toEqual(noPin);
    expect(placeOf(resetStepPlace(document, 'step-1', 'position'), 'step-1')).toEqual({ scale: PLACED.scale });
    expect('place' in stepById(resetStepPlace(document, 'step-1', 'all'), 'step-1')!).toBe(false);
    // Nothing to reset is no edit.
    expect(resetStepPlace(document, 'step-2', 'all')).toBe(document);
    expect(resetStepPlace(resetStepPlace(document, 'step-1', 'text'), 'step-1', 'text')).toEqual(resetStepPlace(document, 'step-1', 'text'));
  });

  it('drops a newer build’s placement only when the whole of it is reset', () => {
    const newer: DiagramStep = { ...cpStep('step-1'), placeNewer: { frame: [1, 1], tilt: 3 } };
    const document = diagram(newer);
    expect(resetStepPlace(document, 'step-1', 'position')).toBe(document);
    const reset = stepById(resetStepPlace(document, 'step-1', 'all'), 'step-1')!;
    expect('placeNewer' in reset).toBe(false);
    expect(isPlacedStep(reset)).toBe(false);
    expect(isPlacedStep(newer)).toBe(true);
  });

  it('resets every step of a set, or of the diagram, a newer build’s placement included and a newer build’s step left alone', () => {
    const locked: DiagramStep = { ...createStep(() => 'step-locked'), unknown: { id: 'step-locked', place: { frame: [1, 1] } } };
    const document = diagram(
      { ...cpStep('step-1'), place: PLACED },
      { ...cpStep('step-2'), placeNewer: { tilt: 3 } },
      { ...cpStep('step-3'), place: { text: [1, 0] } },
      locked
    );
    const some = resetStepPlaces(document, new Set(['step-1', 'step-2']));
    expect(placeOf(some, 'step-1')).toBeUndefined();
    expect(stepById(some, 'step-2')!.placeNewer).toBeUndefined();
    expect(placeOf(some, 'step-3')).toEqual({ text: [1, 0] });
    const all = resetStepPlaces(document, null);
    expect(all.steps.filter((entry) => 'place' in entry || 'placeNewer' in entry)).toEqual([]);
    expect(stepById(all, 'step-locked')).toBe(locked);
    expect(resetStepPlaces(all, null)).toBe(all);
  });
});

describe('a duplicated step', () => {
  it('keeps the pin and the parts’ offsets, and leaves the frame offset to the original’s cell', () => {
    const document = diagram({ ...cpStep('step-1'), place: PLACED });
    const copy = duplicateStep(document, 'step-1', () => 'step-copy')!;
    const { frame: _frame, ...rest } = PLACED;
    expect(placeOf(copy.document, 'step-copy')).toEqual(rest);
    expect(placeOf(copy.document, 'step-1')).toEqual(PLACED);
    // A placement that was only a frame offset leaves the copy with none.
    const framed = duplicateStep(diagram({ ...cpStep('step-1'), place: { frame: [2, 0] } }), 'step-1', () => 'step-copy')!;
    expect('place' in stepById(framed.document, 'step-copy')!).toBe(false);
  });

  it('carries a newer build’s placement as it came, but for its frame offset, which belongs to the original’s cell', () => {
    const placeNewer = { frame: [1, 1], tilt: 3 };
    const copy = duplicateStep(diagram({ ...cpStep('step-1'), placeNewer }), 'step-1', () => 'step-copy')!;
    expect(stepById(copy.document, 'step-copy')!.placeNewer).toEqual({ tilt: 3 });
    expect(stepById(copy.document, 'step-1')!.placeNewer).toBe(placeNewer);
    // With no frame offset, the copy's is the original's.
    const unframed = { tilt: 3 };
    const plain = duplicateStep(diagram({ ...cpStep('step-1'), placeNewer: unframed }), 'step-1', () => 'step-copy')!;
    expect(stepById(plain.document, 'step-copy')!.placeNewer).toEqual(unframed);
  });
});

describe('a diagram laid out as if nothing were placed', () => {
  it('leaves out every placement the layout would apply, and is the same diagram when there is none', () => {
    const newer: DiagramStep = { ...cpStep('step-2'), placeNewer: { frame: [1, 1], tilt: 3 } };
    const document = diagram({ ...cpStep('step-1'), place: PLACED }, newer, createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'));
    const unplaced = unplacedDiagram(document);
    expect(placeOf(unplaced, 'step-1')).toBeUndefined();
    expect('place' in stepById(unplaced, 'step-1')!).toBe(false);
    expect(stepById(unplaced, 'step-2')).toBe(newer);
    expect(unplaced.steps[2]).toBe(document.steps[2]);
    expect(unplacedDiagram(unplaced)).toBe(unplaced);
  });
});

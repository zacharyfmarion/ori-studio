import { describe, expect, it } from 'vitest';

import {
  annotationsOutOfStep,
  createDiagram,
  createStep,
  createTurn,
  insertSteps,
  nearestEarlierShowAs,
  pullReferencesSteps,
  setFoldStepPicture,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from './diagramDocument';
import { cpStep, foldStepSource, foldStepStep, referencesStep, scenePicture, stepsIn } from './diagramSteps.fixtures';

/** A mark the fold brought, as it arrives. */
const fold = (id: string, patch: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id,
  kind: 'valley-arrow',
  from: [0.2, 0.6],
  to: [0.6, 0.2],
  bend: 0.25,
  imported: 'untouched',
  ...patch,
});

/** The author's own mark. */
const AUTHOR: KnownDiagramAnnotation = { id: 'mine', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };

/** A diagram of one step linked to a Fold step, its fold's marks and the author's own drawn on its picture. */
function linked(annotations: KnownDiagramAnnotation[] = [fold('f-1'), AUTHOR]) {
  const step = foldStepStep('step-1');
  const drawn: DiagramStep = { ...step, annotations, annotatedPictureKey: step.picture!.key };
  return insertSteps(createDiagram({ title: 'Kite' }), [drawn], 0);
}

describe('a Fold step’s capture committed (D17)', () => {
  it('swaps the fold’s marks for the capture’s when the state changed upstream, and keeps the author’s', () => {
    const { document, replaced } = setFoldStepPicture(linked(), 'step-1', {
      source: foldStepSource({ state: 'fs1:another' }),
      picture: { ...scenePicture(), key: 'scene-new' },
      marks: [fold('f-2', { from: [0.1, 0.1] })],
    });
    const step = stepsIn(document)[0]!;
    expect(step.annotations.map((mark) => mark.id)).toEqual(['f-2', 'mine']);
    expect(replaced).toBe(0);
    // The author's mark was drawn on the old picture: it says so; the fold's are in step with the new one.
    expect(annotationsOutOfStep(step)).toBe(true);
  });

  it('counts an edited mark of the fold it swapped away, for the toast that offers it back', () => {
    const { replaced } = setFoldStepPicture(linked([fold('f-1', { imported: 'edited' })]), 'step-1', {
      source: foldStepSource({ state: 'fs1:another' }),
      picture: { ...scenePicture(), key: 'scene-new' },
      marks: [fold('f-2')],
    });
    expect(replaced).toBe(1);
  });

  it('keeps the fold’s marks, edited or not, through a pose of the same state', () => {
    const marks = [fold('f-1', { imported: 'edited' }), AUTHOR];
    const { document } = setFoldStepPicture(linked(marks), 'step-1', {
      source: foldStepSource({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 90, foldCase: 1 } }),
      picture: { ...scenePicture(), key: 'scene-turned' },
      marks: [fold('f-2')],
    });
    expect(stepsIn(document)[0]!.annotations.map((mark) => mark.id)).toEqual(['f-1', 'mine']);
  });

  it('words the step anew while its words are still the sentence it was captured with', () => {
    const sentence = 'Mountain fold the corner behind.';
    const recaptured = (diagram: ReturnType<typeof linked>) =>
      stepsIn(
        setFoldStepPicture(diagram, 'step-1', {
          source: foldStepSource({ state: 'fs1:another', sentence }),
          picture: { ...scenePicture(), key: 'scene-new' },
          marks: [],
        }).document
      )[0]!.text;
    expect(recaptured(linked())).toBe(sentence);
    const edited = linked();
    const step = stepsIn(edited)[0]!;
    const own = { ...edited, steps: [{ ...step, text: 'Fold the kite’s edge in.' }] };
    expect(recaptured(own)).toBe('Fold the kite’s edge in.');
  });

  it('rewords and repositions untouched Repeat callouts when posed, preserving edited and author callouts', () => {
    const callout = fold('repeat', { kind: 'callout', text: 'Repeat on the right', from: [0.8, 0.3], to: [0.75, -0.12] });
    const fresh = fold('new-repeat', { kind: 'callout', text: 'Repeat at the bottom', from: [0.7, 0.8], to: [0.7, 1.12] });
    for (const imported of ['untouched', 'edited'] as const) {
      const { document } = setFoldStepPicture(linked([{ ...callout, imported }, { ...callout, id: 'author', imported: undefined, text: 'My note' }]), 'step-1', {
        source: foldStepSource({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 90, foldCase: 1 } }),
        picture: { ...scenePicture(), key: 'scene-turned' },
        marks: [fresh],
      });
      const marks = stepsIn(document)[0]!.annotations;
      expect(marks[0]).toMatchObject(imported === 'untouched' ? { ...fresh, id: 'repeat' } : { text: 'Repeat on the right', imported: 'edited' });
      expect(marks[1]).toMatchObject({ id: 'author', text: 'My note' });
    }
  });

  it('is no edit when nothing changed', () => {
    const document = linked();
    const step = stepsIn(document)[0]!;
    const same = setFoldStepPicture(document, 'step-1', {
      source: step.source as ReturnType<typeof foldStepSource>,
      picture: step.picture,
      marks: [],
    });
    expect(same.document).toBe(document);
  });
});

describe('a pull of Fold steps (D17)', () => {
  it('makes each a step with its picture, its fold’s marks and its words, and a turn a turn', () => {
    const picture = scenePicture('scene-fold');
    const { document, stepIds, turnIds } = pullReferencesSteps(
      createDiagram({ title: 'Kite' }),
      [
        { kind: 'turn-over', axis: 'vertical' },
        { source: foldStepSource(), picture, lifted: { picture, annotations: [fold('f-1')] }, text: 'Valley fold.' },
      ],
      { kind: 'end' }
    );
    expect(turnIds).toHaveLength(1);
    const step = stepsIn({ steps: document.steps.filter((entry) => stepIds.includes(entry.id)) })[0]!;
    expect(step).toMatchObject({ text: 'Valley fold.', annotatedPictureKey: 'scene-fold', picture });
    expect(step.annotations).toEqual([fold('f-1')]);
  });
});

describe('a Fold step in the run the pattern picker follows (review fix 3)', () => {
  it('counts as posed, as a linked pattern does: a step after it links the way it is shown', () => {
    const document = insertSteps(
      createDiagram(),
      [
        cpStep('step-cp', { mode: 'crease-pattern', rotationDeg: 0 }),
        foldStepStep('step-fold'),
        createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'),
        referencesStep('step-r'),
        createStep(() => 'step-new'),
        foldStepStep('step-fold-cp', { render: { mode: 'crease-pattern', rotationDeg: 90 } }),
        createStep(() => 'step-last'),
      ],
      0
    );
    // Past the turn and the References step, to the Fold step shown folded, not the pattern before it.
    expect(nearestEarlierShowAs(document, 'step-new')).toBe('folded');
    expect(nearestEarlierShowAs(document, 'step-last')).toBe('crease-pattern');
    expect(nearestEarlierShowAs(document, 'step-fold')).toBe('crease-pattern');
  });
});

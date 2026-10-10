/**
 * Make Marks Editable (17e, RM8): a References step made before marks were
 * lifted keeps them in its picture until this is pressed; then they lift as a
 * fresh pull lifts them, as one undo step, counted by where it was pressed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MAX_STEP_ANNOTATIONS } from '../annotate/annotationModel';
import {
  createDiagram,
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  insertSteps,
  stepById,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { referencesSource } from '../document/diagramSteps.fixtures';
import { makeStepMarksEditable } from './makeMarksEditable';
import { framedCard, pointsCard } from './referencesCardMarks.fixtures';
import { liftedCardPicture } from './referencesCardMarks';

const analytics = vi.hoisted(() => ({ trackDiagramReferencesMarksLifted: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const PICTURE = { kind: 'step-diagram' as const, model: pointsCard(), mirrored: false, key: 'steps-p' };
const circle = (id: string): KnownDiagramAnnotation => ({ id, kind: 'circle', from: [0.3, 0.3], to: [0.3, 0.3] });

/** A step pulled before marks were lifted: Zach's screenshot's kind of card, whole in its picture, `own` marks over it. */
function old(own: readonly KnownDiagramAnnotation[] = []): DiagramStep {
  return {
    ...createStep(() => 'step-old'),
    source: referencesSource({ way: 'way-1' }),
    picture: PICTURE,
    annotations: [...own],
    annotatedPictureKey: PICTURE.key,
  };
}

function open(step: DiagramStep): DiagramDocument {
  const diagram = insertSteps(createDiagram({ title: 'Old', newId: () => 'diagram-old' }), [step], 0);
  useWorkspaceStore.setState({ diagram });
  return diagram;
}

const stepNow = () => stepById(state().diagram!, 'step-old')!;
const every = liftedCardPicture(PICTURE, { letters: true, highlights: true }, DEFAULT_DIAGRAM_STYLE)!.annotations.length;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
});

describe('Make Marks Editable', () => {
  it('lifts every mark of the step’s card as one undo step, counts it by where it was pressed, and says so', () => {
    const before = open(old([circle('annotation-mine')]));
    const past = state().diagramHistory.past.length;
    expect(makeStepMarksEditable('step-old', 'annotate_notice')).toBe(true);
    const step = stepNow();
    expect(step.picture).toMatchObject({ kind: 'step-diagram', key: 'steps-p-marks' });
    expect(step.annotations).toHaveLength(every + 1);
    expect(step.annotations.at(-1)).toEqual(circle('annotation-mine'));
    expect(step.annotatedPictureKey).toBe('steps-p-marks');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(analytics.trackDiagramReferencesMarksLifted).toHaveBeenCalledExactlyOnceWith('annotate_notice', every);
    expect(toasts.success).toHaveBeenCalledWith(`Step 1’s ${every} marks are editable now`);
    // Undo gives the step back as it was: its card whole in its picture.
    expect(state().undoDiagram()).toBe(true);
    expect(state().diagram).toEqual(before);
  });

  it('on an enlarged step, counts and says the marks it holds now, and how many its frame left out, with Undo', () => {
    // The frame (a circle of radius 0.2 round the middle) holds four of the card's seven marks (§5).
    const zoom = { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.5] as [number, number], radius: 0.2 } };
    const picture = { kind: 'step-diagram' as const, model: framedCard(), mirrored: false, key: 'steps-f' };
    const before = open({ ...old(), picture, annotatedPictureKey: picture.key, zoom });
    expect(liftedCardPicture(picture, { letters: true, highlights: true }, DEFAULT_DIAGRAM_STYLE)!.annotations).toHaveLength(7);
    expect(makeStepMarksEditable('step-old', 'step_pane')).toBe(true);
    expect(stepNow().annotations).toHaveLength(4);
    expect(analytics.trackDiagramReferencesMarksLifted).toHaveBeenCalledExactlyOnceWith('step_pane', 4);
    expect(toasts.success).toHaveBeenCalledExactlyOnceWith('Step 1’s 4 marks are editable now', {
      description: '3 marks outside the enlarged frame were left out',
      action: { label: 'Undo', onClick: expect.any(Function) },
    });
    // Undo, from the toast, gives the step back as it was.
    toasts.success.mock.calls[0]![1].action.onClick();
    expect(state().diagram).toEqual(before);
  });

  it('says so, with Undo, when an edited copy of the card’s mark pasted onto the step goes with the rest', () => {
    // A copy of a lifted arrow the author bent, pasted onto a step showing the same card, keeps its tag (the clipboard).
    const pasted: KnownDiagramAnnotation = {
      id: 'annotation-pasted',
      kind: 'fold-unfold-arrow',
      from: [0.2, 0.2],
      to: [0.8, 0.2],
      bend: 0.33,
      imported: 'edited',
    };
    const before = open(old([pasted, circle('annotation-mine')]));
    expect(makeStepMarksEditable('step-old', 'annotate_notice')).toBe(true);
    expect(stepNow().annotations.map((mark) => mark.id)).not.toContain('annotation-pasted');
    expect(stepNow().annotations).toHaveLength(every + 1);
    expect(analytics.trackDiagramReferencesMarksLifted).toHaveBeenCalledExactlyOnceWith('annotate_notice', every);
    expect(toasts.success).toHaveBeenCalledExactlyOnceWith(`Step 1’s ${every} marks are editable now`, {
      description: 'Replaced a mark you had edited',
      action: { label: 'Undo', onClick: expect.any(Function) },
    });
    toasts.success.mock.calls[0]![1].action.onClick();
    expect(state().diagram).toEqual(before);
  });

  it('does nothing, and says nothing, past what a step holds, on a lifted step, or on a diagram that cannot change', () => {
    open(old(Array.from({ length: MAX_STEP_ANNOTATIONS - every + 1 }, (_, i) => circle(`annotation-mine-${i}`))));
    expect(makeStepMarksEditable('step-old', 'step_pane')).toBe(false);
    expect(stepNow().picture).toBe(PICTURE);

    open(old());
    expect(makeStepMarksEditable('step-old', 'step_pane')).toBe(true);
    vi.clearAllMocks();
    expect(makeStepMarksEditable('step-old', 'step_pane')).toBe(false);

    open(old());
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(makeStepMarksEditable('step-old', 'card_menu')).toBe(false);
    expect(stepNow().picture).toBe(PICTURE);
    expect(analytics.trackDiagramReferencesMarksLifted).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });
});

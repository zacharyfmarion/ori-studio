import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import {
  createDiagram,
  createTurn,
  insertSteps,
  type DiagramDocument,
  type DiagramEntry,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { craneStep, imprintCase } from './zoom.fixtures';
import {
  areaSubtitle,
  buildAnchorActions,
  buildAreaActions,
  buildEnlargedAction,
  buildFrameActions,
  enlargedChips,
  enlargedState,
  frameSubtitle,
  stepsEnlargedFrom,
  stepZoomStatus,
  zoomReadout,
  zoomReadoutText,
} from './zoomActions';
import { enlargeStep, updateEnlargedSteps } from './zoomFrames';
import { paperFacesOf, toPicture } from './zoomImprint';

const t = i18n.getFixedT('en');
const NO_ASSETS = {};

function headArea(step: DiagramStep, id = 'area-head'): KnownDiagramAnnotation {
  const { centre, radius } = toPicture(paperFacesOf(step)!, imprintCase('C.none').frame);
  return { id, kind: 'zoom', from: centre, to: centre, radius };
}
const withArea = (step: DiagramStep, area: KnownDiagramAnnotation): DiagramStep => ({
  ...step,
  annotations: [area],
  annotatedPictureKey: step.picture!.key,
});
const named = (step: DiagramStep, id: string): DiagramStep => ({ ...step, id });
const diagramOf = (...entries: DiagramEntry[]): DiagramDocument => insertSteps(createDiagram({ title: 'Crane' }), entries, 0);

/** Step 1 with the head's area; steps 2 and 3 the crane again, unenlarged. */
function crane(): DiagramDocument {
  const s = craneStep('S.none');
  return diagramOf(withArea(s, headArea(s)), named(craneStep('C.none'), 'step-2'), named(craneStep('C.none'), 'step-3'));
}

describe('the Enlarged toggle (Z2)', () => {
  it('names the step it would capture from, and whether that holds an area or a frame', () => {
    const document = crane();
    const state = enlargedState(document, 'step-2', { readOnly: false })!;
    expect(state).toEqual({ on: false, from: { number: 1, frame: false }, ownAreas: false, readOnly: false, busy: false });
    const enlarge = vi.fn();
    const action = buildEnlargedAction(state, { t, enlarge, unenlarge: vi.fn() });
    expect(action).toMatchObject({ id: 'enlarged', label: 'Enlarged', pressed: false, disabled: false });
    expect(action.hint).toBe('Enlarge from step 1’s area');
    action.run();
    expect(enlarge).toHaveBeenCalledOnce();
    // Step 3, after step 2 enlarged: from step 2's frame.
    const enlarged = enlargeStep(document, 'step-2', NO_ASSETS).document;
    expect(buildEnlargedAction(enlargedState(enlarged, 'step-3', { readOnly: false })!, { t, enlarge, unenlarge: vi.fn() }).hint).toBe(
      'Enlarge from step 2’s frame'
    );
  });

  it('says it removes the step’s own areas, on a duplicate of the area’s step', () => {
    const s = craneStep('S.none');
    const document = diagramOf(withArea(s, headArea(s)), withArea(named(s, 'step-copy'), headArea(s, 'area-copy')));
    const state = enlargedState(document, 'step-copy', { readOnly: false })!;
    expect(state.ownAreas).toBe(true);
    expect(buildEnlargedAction(state, { t, enlarge: vi.fn(), unenlarge: vi.fn() }).hint).toBe(
      'Enlarge from step 1’s area, and remove this step’s own enlarge area'
    );
  });

  it('is held, saying why, when no earlier step has an area or a frame — and on a diagram that cannot change', () => {
    const document = diagramOf(named(craneStep('C.none'), 'step-1'), named(craneStep('C.none'), 'step-2'));
    const enlarge = vi.fn();
    const action = buildEnlargedAction(enlargedState(document, 'step-2', { readOnly: false })!, { t, enlarge, unenlarge: vi.fn() });
    expect(action).toMatchObject({
      disabled: true,
      hint: 'No earlier step has an area to enlarge: draw one with Enlarge',
    });
    action.run();
    expect(enlarge).not.toHaveBeenCalled();
    const readOnly = buildEnlargedAction(enlargedState(crane(), 'step-2', { readOnly: true })!, { t, enlarge, unenlarge: vi.fn() });
    expect(readOnly.disabled).toBe(true);
  });

  it('turns off when on, and waits, refusing, while its capture folds', () => {
    const enlarged = enlargeStep(crane(), 'step-2', NO_ASSETS).document;
    const unenlarge = vi.fn();
    const on = buildEnlargedAction(enlargedState(enlarged, 'step-2', { readOnly: false })!, { t, enlarge: vi.fn(), unenlarge });
    expect(on).toMatchObject({ pressed: true, disabled: false, hint: 'Show the whole picture again' });
    on.run();
    expect(unenlarge).toHaveBeenCalledOnce();
    const busy = buildEnlargedAction(enlargedState(enlarged, 'step-2', { readOnly: false, busy: true })!, {
      t,
      enlarge: vi.fn(),
      unenlarge,
    });
    expect(busy.waiting).toBe(true);
    busy.run();
    expect(unenlarge).toHaveBeenCalledOnce();
  });
});

describe('an area’s and a frame’s rows (Z7)', () => {
  it('say which steps an area was enlarged on, by provenance: one step, a range, or none', () => {
    const document = crane();
    expect(areaSubtitle(t, stepsEnlargedFrom(document, 'area-head'))).toBe('No step is enlarged from it');
    const one = enlargeStep(document, 'step-2', NO_ASSETS).document;
    expect(areaSubtitle(t, stepsEnlargedFrom(one, 'area-head'))).toBe('Enlarged on step 2');
    const two = enlargeStep(one, 'step-3', NO_ASSETS).document;
    expect(areaSubtitle(t, stepsEnlargedFrom(two, 'area-head'))).toBe('Enlarged on steps 2–3');
    expect(frameSubtitle(t, { number: 1 })).toBe('From step 1’s area');
    expect(frameSubtitle(t, null)).toBe('From an area no longer in the diagram');
  });

  it('offer Update Enlarged Steps — held with none — and Go to the first', () => {
    const update = vi.fn();
    const goTo = vi.fn();
    const none = buildAreaActions({ steps: [], readOnly: false }, { t, update, goTo });
    expect(none).toEqual([expect.objectContaining({ id: 'update-enlarged-steps', disabled: true, hint: 'No step is enlarged from this area' })]);
    const steps = [
      { id: 'step-2', number: 2 },
      { id: 'step-3', number: 3 },
    ];
    const [updateAction, goToAction] = buildAreaActions({ steps, readOnly: false }, { t, update, goTo });
    expect(updateAction!.hint).toBe(
      'Place the frame again on steps 2–3 from this area as it is now, over any move made on them'
    );
    expect(buildAreaActions({ steps: steps.slice(0, 1), readOnly: false }, { t, update, goTo })[0]!.hint).toBe(
      'Place the frame again on step 2 from this area as it is now, over any move made on it'
    );
    updateAction!.run();
    goToAction!.run();
    expect(goToAction!.label).toBe('Go to Step 2');
    expect(update).toHaveBeenCalledOnce();
    expect(goTo).toHaveBeenCalledWith('step-2');
    expect(buildFrameActions({ areaStep: { id: 'step-1', number: 1 } }, { t, goTo })[0]!.label).toBe('Go to Area on Step 1');
    expect(buildFrameActions({ areaStep: null }, { t, goTo })).toEqual([]);
  });

  it('offer Pick, pressed while it picks, and Reset while an anchor is picked', () => {
    const pick = vi.fn();
    const reset = vi.fn();
    const canvas = true;
    expect(
      buildAnchorActions({ picked: false, picking: false, readOnly: false, canvas }, { t, pick, reset }).map((each) => each.id)
    ).toEqual(['pick-anchor']);
    const [picking, resetting] = buildAnchorActions({ picked: true, picking: true, readOnly: false, canvas }, { t, pick, reset });
    expect(picking).toMatchObject({ pressed: true, label: 'Pick' });
    expect(resetting).toMatchObject({ id: 'reset-anchor', label: 'Reset' });
    const held = buildAnchorActions({ picked: true, picking: false, readOnly: true, canvas }, { t, pick, reset });
    held.forEach((action) => action.run());
    expect(pick).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('offer no Pick with no canvas to pick on, as on a phone, and still Reset (review of #436)', () => {
    const deps = { t, pick: vi.fn(), reset: vi.fn() };
    expect(buildAnchorActions({ picked: false, picking: false, readOnly: false, canvas: false }, deps)).toEqual([]);
    const ids = buildAnchorActions({ picked: true, picking: false, readOnly: false, canvas: false }, deps).map((each) => each.id);
    expect(ids).toEqual(['reset-anchor']);
  });
});

describe('an enlarged step’s chip and status', () => {
  it('chips each enlarged step with its area’s step, or none once the area is gone, turns passed', () => {
    const enlarged = enlargeStep(crane(), 'step-2', NO_ASSETS).document;
    const steps = [enlarged.steps[0]!, createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn'), ...enlarged.steps.slice(1)];
    expect([...enlargedChips(steps)]).toEqual([['step-2', 1]]);
    expect([...enlargedChips(steps.slice(1))]).toEqual([['step-2', null]]);
  });

  it('names a step captured before steps kept their faces, which only a Refresh, then a capture, anchors', () => {
    const s = craneStep('S.none', { faces: false });
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [0.5, 0.5], to: [0.5, 0.5], radius: 0.1 };
    const document = diagramOf(withArea(s, area), named(craneStep('C.none', { faces: false }), 'step-2'));
    const enlarged = enlargeStep(document, 'step-2', NO_ASSETS).document;
    expect(stepZoomStatus(enlarged, 'step-2')).toEqual({
      areaStep: { id: s.id, number: 1 },
      scale: null,
      notices: [
        { kind: 'refresh', stepId: 'step-2', number: 2, then: { update: 1 } },
        { kind: 'refresh', stepId: s.id, number: 1, then: { update: 1 } },
      ],
    });
    expect(stepZoomStatus(enlarged, s.id)).toBeNull();
  });

  it('keeps saying so once a Refresh gives the steps their faces: the frame is still a copy until captured again', () => {
    const s = craneStep('S.none', { faces: false });
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [0.5, 0.5], to: [0.5, 0.5], radius: 0.1 };
    const enlarged = enlargeStep(diagramOf(withArea(s, area), named(craneStep('C.none'), 'step-2')), 'step-2', NO_ASSETS).document;
    expect(stepZoomStatus(enlarged, 'step-2')!.notices).toEqual([{ kind: 'refresh', stepId: s.id, number: 1, then: { update: 1 } }]);
    // The area's step refreshed, as a Refresh lands: its faces, its picture key the same. The frame is still a copy.
    const faced = withArea({ ...craneStep('S.none'), id: s.id }, area);
    const refreshed = { ...enlarged, steps: enlarged.steps.map((entry) => (entry.id === s.id ? faced : entry)) };
    expect(stepZoomStatus(refreshed, 'step-2')!.notices).toEqual([{ kind: 'unanchored', then: { update: 1 } }]);
    // Captured again, it is anchored, and nothing is said.
    const updated = updateEnlargedSteps(refreshed, 'area', NO_ASSETS).document;
    expect(stepZoomStatus(updated, 'step-2')!.notices).toEqual([]);
    // With the area gone, turning Enlarged off and on is what anchors it.
    const gone = { ...refreshed, steps: refreshed.steps.filter((entry) => entry.id !== s.id) };
    expect(stepZoomStatus(gone, 'step-2')!.notices).toEqual([{ kind: 'unanchored', then: null }]);
  });

  it('says the frame holds no paper, or its anchor is off this paper', () => {
    const enlarged = enlargeStep(crane(), 'step-2', NO_ASSETS).document;
    expect(stepZoomStatus(enlarged, 'step-2')!.notices).toEqual([]);
    const moved = {
      ...enlarged,
      steps: enlarged.steps.map((entry) =>
        entry.id === 'step-2' && 'zoom' in entry && entry.zoom
          ? { ...entry, zoom: { ...entry.zoom, frame: { centre: [3, 3] as [number, number], radius: 0.05 }, imprint: { ...entry.zoom.imprint!, on: [9e3, 9e3] as [number, number] } } }
          : entry
      ),
    };
    expect(stepZoomStatus(moved, 'step-2')!.notices).toEqual([{ kind: 'no-paper' }, { kind: 'anchor-off-paper' }]);
    // A step that is not linked has no faces to tell by.
    expect(cpStep('plain').zoom).toBeUndefined();
  });
});

describe('what an enlarged step prints at, as its read-outs say it (Z4)', () => {
  const say = (zoom: { asked: number | null; printed: number; reduced: boolean }, language = 'en') =>
    zoomReadoutText(t, zoomReadout(zoom)!, language);

  it('says a fixed Size as it was typed, two decimals where it has them, and what Fill or a room makes of it to one', () => {
    expect(say({ asked: 1.25, printed: 1.2500000000002, reduced: false })).toBe('Prints ×1.25');
    expect(say({ asked: 2, printed: 2, reduced: false })).toBe('Prints ×2');
    expect(say({ asked: null, printed: 4.4316, reduced: false })).toBe('Prints ×4.4');
    expect(say({ asked: 2.75, printed: 2.3812, reduced: true })).toBe('Asked ×2.75 · prints ×2.4 — the room is too small');
    expect(say({ asked: null, printed: 1.0812, reduced: false })).toBe('Prints only ×1.1 — draw a smaller area');
  });

  it('writes its numbers as the language does, as the Size field beside it shows them (review of 16g)', () => {
    expect(say({ asked: 1.25, printed: 1.25, reduced: false }, 'de')).toBe('Prints ×1,25');
    expect(say({ asked: 2.75, printed: 2.3812, reduced: true }, 'fr')).toBe('Asked ×2,75 · prints ×2,4 — the room is too small');
    expect(say({ asked: null, printed: 4.4316, reduced: false }, 'ja')).toBe('Prints ×4.4');
  });
});

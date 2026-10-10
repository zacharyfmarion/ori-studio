import { describe, expect, it } from 'vitest';
import {
  createDiagram,
  editStepAnnotations,
  insertSteps,
  removeSteps,
  setLinkedPicture,
  setUploadPose,
  stepById,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramEntry,
  type DiagramStep,
  type KnownDiagramAnnotation,
  type KnownDiagramAsset,
} from '../document/diagramDocument';
import { areaStatus, outOfDate, stepsToUpdate } from './areaStatus';
import { craneStep, imprintCase, turnedCapture } from './zoom.fixtures';
import { zoomAreas } from './zoomCapture';
import { enlargeStep, setFrameEdge, setFrameScale, updateEnlargedSteps } from './zoomFrames';
import { paperFacesOf, toPicture } from './zoomImprint';
import { withZoomAnchor, withZoomEdge, withZoomOutline, withZoomScale, withZoomShape, zoomOutlineOf } from './zoomModel';

/**
 * An enlarged step against the area it was captured from (review fix 4): the
 * record a capture makes, how the step stands — current, changed by hand,
 * deleted, or not known — and that a carry by the area's own picture, a
 * re-pose or a refresh, says nothing.
 */
const NO_ASSETS = {};

function headArea(step: DiagramStep, id = 'area-head'): KnownDiagramAnnotation {
  const { centre, radius } = toPicture(paperFacesOf(step)!, imprintCase('C.none').frame);
  return { id, kind: 'zoom', from: centre, to: centre, radius };
}
const named = (step: DiagramStep, id: string): DiagramStep => ({ ...step, id });
const diagramOf = (...entries: DiagramEntry[]): DiagramDocument => insertSteps(createDiagram({ title: 'Crane' }), entries, 0);

const AREA_STEP = 'step-S.none';

/** Zach's crane: step 1 with the head's area, steps 2 and 3 enlarged from it, one after the other. */
function enlarged(): DiagramDocument {
  const s = craneStep('S.none');
  const document = diagramOf(
    { ...s, annotations: [headArea(s)], annotatedPictureKey: s.picture!.key },
    named(craneStep('C.none'), 'step-2'),
    named(craneStep('C.none'), 'step-3')
  );
  const two = enlargeStep(document, 'step-2', NO_ASSETS).document;
  return enlargeStep(two, 'step-3', NO_ASSETS).document;
}

const step = (document: DiagramDocument, id: string) => stepById(document, id)!;
const theArea = (document: DiagramDocument) => zoomAreas(step(document, AREA_STEP))[0]!;

/** The area edited by hand, as Annotate's drags and the Layers controls edit it: through its step's marks. */
function editArea(document: DiagramDocument, edit: (area: KnownDiagramAnnotation) => KnownDiagramAnnotation): DiagramDocument {
  return editStepAnnotations(document, AREA_STEP, (marks) => marks.map((mark) => (mark.kind === 'zoom' ? edit(mark) : mark)));
}

const nudged = (area: KnownDiagramAnnotation) => {
  const outline = zoomOutlineOf(area);
  return withZoomOutline(area, { ...outline, centre: [outline.centre[0] + 0.03, outline.centre[1]] });
};

const kind = (document: DiagramDocument, id = 'step-2') => areaStatus(document, id)?.kind;

describe('a capture records its area (review fix 4)', () => {
  it('records the area’s step, its outline there and a picked anchor; a step enlarged after it, the same record', () => {
    const document = enlarged();
    const area = theArea(document);
    expect(step(document, 'step-2').zoom!.areaWas).toEqual({ stepId: AREA_STEP, outline: zoomOutlineOf(area) });
    // Step 3 took its frame from step 2's: as out of date as step 2 is, whatever happens to the area.
    expect(step(document, 'step-3').zoom!.areaWas).toEqual(step(document, 'step-2').zoom!.areaWas);
    const anchored = editArea(document, (each) => withZoomAnchor(each, [12, 34]));
    const again = updateEnlargedSteps(anchored, 'area-head', NO_ASSETS).document;
    expect(step(again, 'step-2').zoom!.areaWas!.anchor).toEqual([12, 34]);
  });

  it('records the area’s Size and Edge, which the capture copied (review of review fix 4)', () => {
    const printed = editArea(enlarged(), (each) => withZoomEdge(withZoomScale(each, 2), 'whole'));
    const again = updateEnlargedSteps(printed, 'area-head', NO_ASSETS).document;
    expect(step(again, 'step-2').zoom).toMatchObject({ scale: 2, edge: 'whole', areaWas: { scale: 2, edge: 'whole' } });
  });
});

describe('an enlarged step against its area', () => {
  it('is current as captured, and changed once the area is moved, resized, reshaped or re-anchored by hand', () => {
    const document = enlarged();
    expect(areaStatus(document, 'step-2')).toEqual({ kind: 'current', areaStep: { id: AREA_STEP, number: 1 } });
    expect(kind(editArea(document, nudged))).toBe('changed');
    expect(kind(editArea(document, (area) => ({ ...area, radius: area.radius! * 1.2 })))).toBe('changed');
    expect(kind(editArea(document, (area) => withZoomShape(area, 'rounded')))).toBe('changed');
    expect(kind(editArea(document, (area) => withZoomAnchor(area, [1, 2])))).toBe('changed');
    // Its Size and Edge, which the capture copied: Update would print the step otherwise (review of review fix 4).
    expect(kind(editArea(document, (area) => withZoomScale(area, 2)))).toBe('changed');
    expect(kind(editArea(document, (area) => withZoomEdge(area, 'whole')))).toBe('changed');
    // Every step enlarged from it, through another enlarged step too.
    expect(kind(editArea(document, nudged), 'step-3')).toBe('changed');
    // Derived, never stored: the diagram before the edit — what Undo gives back — is current.
    expect(kind(document)).toBe('current');
    // The area put back by hand where it was.
    const back = editArea(editArea(document, nudged), () => theArea(document));
    expect(kind(back)).toBe('current');
  });

  it('says the area was deleted, naming its step while that is there, and none once it is gone too', () => {
    const document = enlarged();
    const deleted = editStepAnnotations(document, AREA_STEP, (marks) => marks.filter((mark) => mark.kind !== 'zoom'));
    expect(areaStatus(deleted, 'step-2')).toEqual({ kind: 'deleted', areaStep: { id: AREA_STEP, number: 1 } });
    // Its frame is kept: deleting the area changes no step.
    expect(step(deleted, 'step-2').zoom).toBe(step(document, 'step-2').zoom);
    expect(areaStatus(removeSteps(document, [AREA_STEP]), 'step-2')).toEqual({ kind: 'deleted', areaStep: null });
    expect(outOfDate(deleted, 'step-2')).toBe(false);
  });
});

describe('a Size or Edge set on the step (review of review fix 4)', () => {
  it('is its own: the area’s Size or Edge changed says nothing to it, and still says so to a step that took the area’s', () => {
    const own = setFrameScale(enlarged(), 'step-2', 1.5);
    const sized = editArea(own, (area) => withZoomScale(area, 2));
    expect(kind(sized)).toBe('current');
    expect(kind(sized, 'step-3')).toBe('changed');
    expect(stepsToUpdate(sized, ['area-head'])).toEqual(['step-3']);
    // Its Edge it still takes from the area.
    expect(kind(editArea(own, (area) => withZoomEdge(area, 'whole')))).toBe('changed');
    const edged = setFrameEdge(enlarged(), 'step-2', 'whole');
    expect(kind(editArea(edged, (area) => withZoomEdge(area, 'cut')))).toBe('current');
  });

  it('tells an Edge by how it draws: a step saying Cut where its circle’s area leaves it unsaid took the area’s (the crane’s)', () => {
    const said = setFrameEdge(enlarged(), 'step-2', 'cut');
    const whole = editArea(said, (area) => withZoomEdge(area, 'whole'));
    expect(kind(whole)).toBe('changed');
    expect(step(updateEnlargedSteps(whole, 'area-head', NO_ASSETS).document, 'step-2').zoom!.edge).toBe('whole');
    // Said Cut on the area too, nothing changed in how it draws.
    expect(kind(editArea(said, (area) => withZoomEdge(area, 'cut')))).toBe('current');
  });

  it('survives Update, which gives the area’s Size and Edge to a step that took them', () => {
    const own = setFrameEdge(setFrameScale(enlarged(), 'step-2', 1.5), 'step-2', 'whole');
    const edited = editArea(own, (area) => withZoomEdge(withZoomScale(nudged(area), 2), 'cut'));
    expect(stepsToUpdate(edited, ['area-head'])).toEqual(['step-2', 'step-3']);
    const updated = updateEnlargedSteps(edited, 'area-head', NO_ASSETS).document;
    expect(step(updated, 'step-2').zoom).toMatchObject({ scale: 1.5, edge: 'whole' });
    expect(step(updated, 'step-3').zoom).toMatchObject({ scale: 2, edge: 'cut' });
    expect(step(updated, 'step-2').zoom!.areaWas).toMatchObject({ scale: 2, edge: 'cut' });
    expect([kind(updated), kind(updated, 'step-3')]).toEqual(['current', 'current']);
    expect(stepsToUpdate(updated, ['area-head'])).toEqual([]);
  });
});

describe('a step with no record: a file’s from before records', () => {
  /** Steps 2 and 3 as a file written before records reads them. */
  function old(): DiagramDocument {
    const document = enlarged();
    return {
      ...document,
      steps: document.steps.map((entry) => {
        if (!('zoom' in entry) || !entry.zoom) return entry;
        const { areaWas: _was, ...zoom } = entry.zoom;
        return { ...entry, zoom };
      }),
    };
  }

  it('is not said to be out of date, nor placed by Update All, until its area is edited by hand', () => {
    const document = old();
    expect(areaStatus(document, 'step-2')).toEqual({ kind: 'unknown', areaStep: { id: AREA_STEP, number: 1 } });
    expect(outOfDate(document, 'step-2')).toBe(false);
    expect(stepsToUpdate(document, ['area-head'])).toEqual([]);
    expect(areaStatus(removeSteps(document, [AREA_STEP]), 'step-2')).toEqual({ kind: 'unknown', areaStep: null });
    expect(areaStatus(document, AREA_STEP)).toBeNull();
    // A carry by the area's own picture records nothing: no hand edit.
    const turned = setLinkedPicture(document, AREA_STEP, {
      source: turnedCapture(step(document, AREA_STEP), 90).source as DiagramCpSource,
      picture: turnedCapture(step(document, AREA_STEP), 90).picture,
    });
    expect(step(turned, 'step-2').zoom!.areaWas).toBeUndefined();
  });

  it('records the area as it was at the first hand edit, which says it is out of date, in the same edit', () => {
    const document = old();
    const area = theArea(document);
    const moved = editArea(document, nudged);
    expect([kind(moved), kind(moved, 'step-3')]).toEqual(['changed', 'changed']);
    expect(step(moved, 'step-2').zoom!.areaWas).toEqual({ stepId: AREA_STEP, outline: zoomOutlineOf(area) });
    expect(stepsToUpdate(moved, ['area-head'])).toEqual(['step-2', 'step-3']);
    // Its Size, or the area deleted, too.
    expect(kind(editArea(document, (each) => withZoomScale(each, 2)))).toBe('changed');
    const deleted = editStepAnnotations(document, AREA_STEP, (marks) => marks.filter((mark) => mark.kind !== 'zoom'));
    expect(areaStatus(deleted, 'step-2')).toEqual({ kind: 'deleted', areaStep: { id: AREA_STEP, number: 1 } });
    // A mark other than the area edited records nothing.
    const marked = editStepAnnotations(document, AREA_STEP, (marks) => [
      ...marks,
      { id: 'arrow', kind: 'valley-line', from: [0.1, 0.1], to: [0.2, 0.2] },
    ]);
    expect(step(marked, 'step-2').zoom!.areaWas).toBeUndefined();
    // A step that recorded its area keeps its record.
    const mixed = editArea({ ...document, steps: document.steps.map((entry) => (entry.id === 'step-3' ? step(enlarged(), 'step-3') : entry)) }, nudged);
    expect(step(mixed, 'step-3').zoom!.areaWas).toEqual(step(enlarged(), 'step-3').zoom!.areaWas);
    // Undone — the diagram before the edit — it is not known again.
    expect(kind(document)).toBe('unknown');
  });
});

describe('one predicate for out of date (review of review fix 4)', () => {
  it('leaves out a frame that needs a Refresh first: neither the pane nor Update All offers Update for it', () => {
    const s = craneStep('S.none', { faces: false });
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [0.5, 0.5], to: [0.5, 0.5], radius: 0.1 };
    const base = diagramOf({ ...s, annotations: [area], annotatedPictureKey: s.picture!.key }, named(craneStep('C.none'), 'step-2'));
    const document = enlargeStep(base, 'step-2', NO_ASSETS).document;
    expect(outOfDate(document, 'step-2')).toBe(false);
    expect(stepsToUpdate(document, ['area'])).toEqual([]);
    // Its area's step refreshed: Update now anchors the frame, and both offer it.
    const faced = { ...craneStep('S.none'), id: s.id, annotations: [area], annotatedPictureKey: s.picture!.key };
    const refreshed = { ...document, steps: document.steps.map((entry) => (entry.id === s.id ? faced : entry)) };
    expect(outOfDate(refreshed, 'step-2')).toBe(true);
    expect(stepsToUpdate(refreshed, ['area'])).toEqual(['step-2']);
  });
});

describe('a carry by the area’s own picture says nothing (review fix 4)', () => {
  /** The area's step's picture as a capture gives it: re-posed, or refreshed. */
  const capture = (document: DiagramDocument, next: DiagramStep) =>
    setLinkedPicture(document, AREA_STEP, { source: next.source as DiagramCpSource, picture: next.picture });

  it('re-posed, the area turns with its picture, and every record that matched goes with it in the same edit', () => {
    const document = enlarged();
    const turned = capture(document, turnedCapture(step(document, AREA_STEP), 90));
    // The area went with its picture: a carry, not a hand edit.
    expect(zoomOutlineOf(theArea(turned)).centre).not.toEqual(zoomOutlineOf(theArea(document)).centre);
    for (const id of ['step-2', 'step-3']) {
      expect(kind(turned, id)).toBe('current');
      expect(step(turned, id).zoom!.areaWas!.outline).toEqual(zoomOutlineOf(theArea(turned)));
      // Only the record moved: the frame, the step's own, is where it was.
      expect(step(turned, id).zoom!.frame).toBe(step(document, id).zoom!.frame);
    }
  });

  it('refreshed, the area stays where it was and says nothing', () => {
    const document = enlarged();
    const before = step(document, AREA_STEP);
    const refreshed = capture(document, {
      ...craneStep('C.none'),
      source: { ...(before.source as DiagramCpSource), fingerprint: 'fp-refolded' },
    });
    expect(step(refreshed, AREA_STEP).picture!.key).not.toBe(before.picture!.key);
    expect(theArea(refreshed)).toEqual(theArea(document));
    expect(kind(refreshed)).toBe('current');
  });

  it('an area moved by hand first is still out of date once its picture is re-posed', () => {
    const moved = editArea(enlarged(), nudged);
    const turned = capture(moved, turnedCapture(step(moved, AREA_STEP), 90));
    expect(kind(turned)).toBe('changed');
    expect(kind(turned, 'step-3')).toBe('changed');
  });

  it('carries only the place: an area given another Size by hand first is still out of date once re-posed', () => {
    const sized = editArea(enlarged(), (area) => withZoomScale(area, 2));
    const turned = capture(sized, turnedCapture(step(sized, AREA_STEP), 90));
    expect(step(turned, 'step-2').zoom!.areaWas!.outline).toEqual(zoomOutlineOf(theArea(turned)));
    expect(step(turned, 'step-2').zoom!.areaWas!.scale).toBeUndefined();
    expect(kind(turned)).toBe('changed');
  });

  it('an upload holding the area, turned in Pose, carries it and its records', () => {
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
    const asset: KnownDiagramAsset = { id: 'asset-1', kind: 'svg', svg: SVG, widthPx: 400, heightPx: 300, bytes: SVG.length };
    const area: KnownDiagramAnnotation = { id: 'area-up', kind: 'zoom', from: [0.3, 0.4], to: [0.3, 0.4], radius: 0.1 };
    const upload: DiagramStep = {
      ...craneStep('C.none'),
      id: 'step-u',
      source: { kind: 'upload', assetId: 'asset-1', rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: 'asset-1', paperScale: null, key: 'asset:asset-1' },
      annotations: [area],
      annotatedPictureKey: 'asset:asset-1',
    };
    const base = { ...diagramOf(upload, named(craneStep('C.none'), 'step-2')), assets: { 'asset-1': asset } };
    const document = enlargeStep(base, 'step-2', base.assets).document;
    expect(kind(document)).toBe('current');
    const posed = setUploadPose(document, 'step-u', { rotationQuarterTurns: 1, mirrored: false });
    expect(zoomAreas(step(posed, 'step-u'))[0]!.from).not.toEqual(area.from);
    expect(kind(posed)).toBe('current');
    // Moved by hand, it is out of date.
    const moved = editStepAnnotations(posed, 'step-u', (marks) => marks.map((mark) => (mark.kind === 'zoom' ? nudged(mark) : mark)));
    expect(kind(moved)).toBe('changed');
  });
});

describe('Update and Update All bring steps up to date (review fix 4)', () => {
  it('Update places one step again and records the area as it is now; Update All the steps out of date', () => {
    const moved = editArea(enlarged(), nudged);
    expect(stepsToUpdate(moved, ['area-head'])).toEqual(['step-2', 'step-3']);
    const one = updateEnlargedSteps(moved, 'area-head', NO_ASSETS, ['step-2']);
    expect(one.stepIds).toEqual(['step-2']);
    expect(kind(one.document)).toBe('current');
    expect(step(one.document, 'step-2').zoom!.areaWas!.outline).toEqual(zoomOutlineOf(theArea(moved)));
    expect(kind(one.document, 'step-3')).toBe('changed');
    expect(stepsToUpdate(one.document, ['area-head'])).toEqual(['step-3']);
    const all = updateEnlargedSteps(one.document, 'area-head', NO_ASSETS, stepsToUpdate(one.document, ['area-head']));
    expect(stepsToUpdate(all.document, ['area-head'])).toEqual([]);
    expect(kind(all.document, 'step-3')).toBe('current');
  });
});

import { describe, expect, it } from 'vitest';
import {
  createDiagram,
  insertSteps,
  stepById,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { craneStep, imprintCase } from './zoom.fixtures';
import { anchorFace, anchorFaceRing, anchorPickable, faceUnder, pickedAnchor } from './zoomAnchor';
import { capture } from './zoomCapture';
import { enlargeStep, setFrameAnchor } from './zoomFrames';
import { defaultAnchor, faceAt, paperFacesOf, pointToScene, toPicture, toScene, topDrawn } from './zoomImprint';
import { withZoomAnchor } from './zoomModel';

const NO_ASSETS = {};

function headArea(step: DiagramStep): KnownDiagramAnnotation {
  const { centre, radius } = toPicture(paperFacesOf(step)!, imprintCase('C.none').frame);
  return { id: 'area-head', kind: 'zoom', from: centre, to: centre, radius };
}

function crane(area: KnownDiagramAnnotation = headArea(craneStep('S.none'))): DiagramDocument {
  const s = craneStep('S.none');
  return insertSteps(
    createDiagram({ title: 'Crane' }),
    [{ ...s, annotations: [area], annotatedPictureKey: s.picture!.key }, { ...craneStep('C.none'), id: 'step-n' }],
    0
  );
}

/** A point of the body's back layer, well outside the head: what a pick there anchors to. */
function bodyPoint(step: DiagramStep): [number, number] {
  const faces = paperFacesOf(step)!;
  const ring = faces.unspread[anchorFace(step, { kind: 'area', area: headArea(step) })!]!;
  const [x, y] = ring.reduce(([sx, sy], [px, py]) => [sx + px / ring.length, sy + py / ring.length], [0, 0]);
  const { minX, minY, maxX, maxY } = faces.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return [(x - minX) / unit, (y - minY) / unit];
}

describe('the anchor on the screen (Revision 2, 16e)', () => {
  it('can be picked on a flat fold’s faces, not on a step with none', () => {
    expect(anchorPickable(craneStep('S.none'))).toBe(true);
    expect(anchorPickable(craneStep('S.none', { faces: false }))).toBe(false);
  });

  it('outlines an area’s default anchor face, the backmost outside it, in picture units', () => {
    const s = craneStep('S.none');
    const area = headArea(s);
    const face = anchorFace(s, { kind: 'area', area })!;
    const faces = paperFacesOf(s)!;
    expect(faces.levels[face]).toBe(Math.max(...faces.levels.filter((_, index) => faces.drawn[index]!.length >= 3)));
    const ring = anchorFaceRing(s, { kind: 'area', area })!;
    expect(ring).toHaveLength(faces.drawn[face]!.length);
    expect(pointToScene(faces, ring[0]!)).toEqual([expect.closeTo(faces.drawn[face]![0]![0], 9), expect.closeTo(faces.drawn[face]![0]![1], 9)]);
  });

  it('finds the face drawn on top under the pointer, and the paper point a click there anchors to', () => {
    const s = craneStep('S.none');
    const centre = headArea(s).from;
    const under = faceUnder(s, centre)!;
    expect(under.face).toBe(topDrawn(paperFacesOf(s)!, pointToScene(paperFacesOf(s)!, centre)));
    const on = pickedAnchor(s, centre)!;
    expect(faceAt(paperFacesOf(s)!, on)).not.toBeNull();
    expect(faceUnder(s, [-2, -2])).toBeNull();
    expect(pickedAnchor(s, [-2, -2])).toBeNull();
  });

  it('takes a picked point for an area’s anchor, which a later capture lands through', () => {
    const s = craneStep('S.none');
    const picked = pickedAnchor(s, bodyPoint(s))!;
    const document = crane(withZoomAnchor(headArea(s), picked));
    expect(anchorFace(stepById(document, s.id)!, { kind: 'area', area: withZoomAnchor(headArea(s), picked) })).toBe(
      faceAt(paperFacesOf(s)!, picked)
    );
    const captured = capture(document, 'step-n')!;
    expect(captured.anchor).toBe('picked');
    expect(captured.zoom.imprint!.on).toEqual(picked);
    expect(captured.zoom.imprint!.picked).toBe(true);
  });

  it('outlines a frame’s anchor face; a pick moves the face and leaves the frame, Reset goes back to the rule', () => {
    const enlarged = enlargeStep(crane(), 'step-n', NO_ASSETS).document;
    const n = stepById(enlarged, 'step-n')!;
    const auto = anchorFace(n, { kind: 'frame' });
    expect(auto).not.toBeNull();
    expect(anchorFaceRing(n, { kind: 'frame' })).not.toBeNull();
    const { centre } = n.zoom!.frame!;
    const picked = pickedAnchor(n, centre)!;
    const after = stepById(setFrameAnchor(enlarged, 'step-n', picked), 'step-n')!;
    expect(after.zoom!.frame).toEqual(n.zoom!.frame);
    expect(after.zoom!.imprint).toMatchObject({ on: picked, picked: true });
    expect(anchorFace(after, { kind: 'frame' })).toBe(faceAt(paperFacesOf(after)!, picked));
    // Reset: the default rule worked out afresh on this step's own faces, as a capture from it would.
    const reset = stepById(setFrameAnchor(setFrameAnchor(enlarged, 'step-n', picked), 'step-n', null), 'step-n')!;
    expect(reset.zoom!.imprint!.picked).toBeUndefined();
    const faces = paperFacesOf(reset)!;
    expect(anchorFace(reset, { kind: 'frame' })).toBe(defaultAnchor(faces, toScene(faces, reset.zoom!.frame!)));
    expect(reset.zoom!.frame).toEqual(n.zoom!.frame);
  });
});

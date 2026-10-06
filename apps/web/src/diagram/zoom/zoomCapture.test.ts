import { describe, expect, it } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import type { PicturePoint } from '../annotate/annotationModel';
import { cpDocument, fakeCaptureRuntime, twoSquaresSegmentation } from '../capture/capture.fixtures';
import { captureStep } from '../capture/captureFolded';
import {
  createDiagram,
  createTurn,
  DEFAULT_DIAGRAM_STYLE,
  editStepAnnotations,
  insertSteps,
  moveStep,
  removeSteps,
  stepById,
  type DiagramCpRender,
  type DiagramDocument,
  type DiagramEntry,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { craneStep, imprintCase } from './zoom.fixtures';
import { anchorOf, capture, captureSource, seededZoom, stepsFrom } from './zoomCapture';
import { enlargeStep, relandFrame, reposeFrame, setFrameOutline, unenlargeStep, updateEnlargedSteps } from './zoomFrames';
import { anchorPoint, defaultAnchor, facePlacement, paperFacesOf, toPicture, toScene } from './zoomImprint';
import { zoomOutlineOf } from './zoomModel';

const NO_ASSETS = {};

/** The head frame 16.0 drew on step 22 (C's), as an area on that step, in its picture units. */
function headArea(step: DiagramStep, spread: 'none' | 'affine' | 'depth', id = 'area-head', more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation {
  const faces = paperFacesOf(step)!;
  const { centre, radius } = toPicture(faces, imprintCase(`C.${spread}`).frame);
  return { id, kind: 'zoom', from: centre, to: centre, radius, ...more };
}

function withArea(step: DiagramStep, area: KnownDiagramAnnotation): DiagramStep {
  return { ...step, annotations: [area], annotatedPictureKey: step.picture!.key };
}

function diagramOf(...entries: DiagramEntry[]): DiagramDocument {
  return insertSteps(createDiagram({ title: 'Crane' }), entries, 0);
}

const renamed = (step: DiagramStep, id: string): DiagramStep => ({ ...step, id });
const locked = (id: string): DiagramStep => ({ ...cpStep(id), unknown: { id, hologram: true } });
const zoomOf = (document: DiagramDocument, id: string) => stepById(document, id)!.zoom;
const distance = (a: PicturePoint, b: PicturePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('where a capture is taken from', () => {
  const s = withArea(craneStep('S.affine'), headArea(craneStep('S.affine'), 'affine'));
  const n = renamed(craneStep('C.affine'), 'step-n');

  it('is the nearest earlier step with an area — its first — or a frame, turns and a newer build’s step passed over', () => {
    const document = diagramOf(s, createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'), locked('step-locked'), n);
    const source = captureSource(document, 'step-n')!;
    expect(source.step.id).toBe(s.id);
    expect('area' in source && source.area.id).toBe('area-head');
    const enlarged = enlargeStep(document, 'step-n', NO_ASSETS).document;
    const after = renamed(craneStep('C.depth'), 'step-after');
    const fromFrame = captureSource(insertSteps(enlarged, [after], enlarged.steps.length), 'step-after')!;
    expect(fromFrame.step.id).toBe('step-n');
    expect('zoom' in fromFrame).toBe(true);
    expect(captureSource(diagramOf(n, s), 'step-n')).toBeNull();
  });

  it('keeps the area’s id as provenance, inherited through an enlarged step', () => {
    const document = enlargeStep(diagramOf(s, n), 'step-n', NO_ASSETS).document;
    expect(zoomOf(document, 'step-n')?.from).toBe('area-head');
    const next = insertSteps(document, [renamed(craneStep('C.none'), 'step-next')], 2);
    expect(capture(next, 'step-next')?.zoom.from).toBe('area-head');
  });
});

describe('capturing a frame', () => {
  it('imprints the area through S’s default anchor, worked out afresh, and lands it on N through the face holding its point', () => {
    const s = withArea(craneStep('S.affine'), headArea(craneStep('S.affine'), 'affine'));
    const n = renamed(craneStep('C.affine'), 'step-n');
    const captured = capture(diagramOf(s, n), 'step-n')!;
    expect(captured).toMatchObject({ placed: 'face', anchor: 'auto' });
    const faces = paperFacesOf(s)!;
    const drawn = toScene(faces, zoomOutlineOf(s.annotations[0] as KnownDiagramAnnotation));
    expect(captured.zoom.imprint!.on).toEqual(anchorPoint(faces, defaultAnchor(faces, drawn)!));
    expect(captured.zoom.imprint!.picked).toBeUndefined();
    // Where N's own painter draws the paper under the area's centre, within 2% of the frame.
    const landed = toScene(paperFacesOf(n)!, captured.zoom.frame!);
    expect(distance(landed.centre, imprintCase('C.affine').truth) / (2 * landed.radius!)).toBeLessThan(0.02);
    expect(captured.zoom).toMatchObject({ from: 'area-head', shape: 'circle' });
  });

  it('copies a picked anchor, so a series of steps keeps one point on the paper', () => {
    const plain = craneStep('S.none');
    const faces = paperFacesOf(plain)!;
    const picked = faces.paper[33]![0]!.map((value, axis) => (value + faces.paper[33]![2]![axis]!) / 2) as PicturePoint;
    const s = withArea(plain, headArea(plain, 'none', 'area-head', { anchor: picked, scale: 2, edge: 'whole' }));
    const captured = capture(diagramOf(s, renamed(craneStep('C.none'), 'step-n')), 'step-n')!;
    expect(captured.anchor).toBe('picked');
    expect(captured.zoom.imprint).toMatchObject({ on: picked, picked: true });
    expect(captured.zoom).toMatchObject({ scale: 2, edge: 'whole' });
    // Captured on again from the enlarged step, the same point.
    const document = enlargeStep(diagramOf(s, renamed(craneStep('C.none'), 'step-n')), 'step-n', NO_ASSETS).document;
    const next = insertSteps(document, [renamed(craneStep('C.affine'), 'step-next')], 2);
    expect(capture(next, 'step-next')!.zoom.imprint).toMatchObject({ on: picked, picked: true });
  });

  it('seeds a step with no picture with the imprint, and its first picture lands it', () => {
    const s = withArea(craneStep('S.none'), headArea(craneStep('S.none'), 'none'));
    const empty: DiagramStep = { ...cpStep('step-n'), picture: null, source: null };
    const document = enlargeStep(diagramOf(s, empty), 'step-n', NO_ASSETS).document;
    const seeded = zoomOf(document, 'step-n')!;
    expect(seeded.imprint).toBeDefined();
    // Beside it, the area copied in picture units, for a first picture the imprint cannot land on.
    expect(seeded.frame).toEqual(zoomOutlineOf(s.annotations[0] as KnownDiagramAnnotation));
    const linked = { ...renamed(craneStep('C.none'), 'step-n'), zoom: seeded };
    const landed = relandFrame(linked);
    const direct = capture(diagramOf(s, renamed(craneStep('C.none'), 'step-n')), 'step-n')!.zoom;
    expect(landed.zoom!.frame!.centre[0]).toBeCloseTo(direct.frame!.centre[0], 12);
    expect(landed.zoom!.frame!.centre[1]).toBeCloseTo(direct.frame!.centre[1], 12);
  });

  it('gives a seeded step whose first picture has no faces the frame it copied, and lands the imprint on a later one that has', () => {
    const s = withArea(craneStep('S.affine'), headArea(craneStep('S.affine'), 'affine'));
    let document = enlargeStep(diagramOf(s, renamed(craneStep('C.affine'), 'step-n')), 'step-n', NO_ASSETS).document;
    // Insert Step After the enlarged step: an empty step, seeded from its frame.
    document = insertSteps(document, [{ ...cpStep('step-new'), picture: null, source: null }], 2);
    const seed = seededZoom(document, 'step-new')!;
    expect(seed.frame).toEqual(zoomOf(document, 'step-n')!.frame);
    // Its first picture has no faces: a 3D or simulated link, a fold drawn as a fixed picture, an older capture.
    const faceless: DiagramStep = { ...renamed(craneStep('C.depth', { faces: false }), 'step-new'), zoom: seed };
    const shown = relandFrame(faceless);
    expect(shown.zoom!.frame).toEqual(seed.frame);
    // Re-posed onto a picture with faces, the imprint lands, as on any enlarged step.
    const withFaces: DiagramStep = { ...renamed(craneStep('C.depth'), 'step-new'), zoom: seed };
    const reposed = reposeFrame(shown, withFaces, null, NO_ASSETS);
    expect(reposed.zoom!.frame).toEqual(relandFrame(withFaces).zoom!.frame);
    expect(reposed.zoom!.frame).not.toEqual(seed.frame);
    // And so it does on a seeded step stored with no frame beside its imprint.
    const { frame: _frame, ...bare } = seed;
    expect(reposeFrame({ ...faceless, zoom: bare }, { ...withFaces, zoom: bare }, null, NO_ASSETS).zoom!.frame).toEqual(reposed.zoom!.frame);
  });

  it('starts a step added after an enlarged step enlarged, and none after a step that only holds an area', () => {
    const s = withArea(craneStep('S.none'), headArea(craneStep('S.none'), 'none'));
    const n = renamed(craneStep('C.none'), 'step-n');
    const added: DiagramStep = { ...cpStep('step-added'), picture: null, source: null };
    expect(seededZoom(diagramOf(s, added), 'step-added')).toBeNull();
    const enlarged = enlargeStep(diagramOf(s, n), 'step-n', NO_ASSETS).document;
    const after = insertSteps(enlarged, [createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'), added], 2);
    const seeded = seededZoom(after, 'step-added')!;
    // Captured from the enlarged step's frame, as Enlarged would: its imprint kept for the first picture.
    expect(seeded).toEqual(capture(after, 'step-added')!.zoom);
    expect(seeded).toMatchObject({ from: 'area-head', shape: 'circle' });
    expect(seeded.imprint).toBeDefined();
    expect(seeded.frame).toEqual(zoomOf(enlarged, 'step-n')!.frame);
  });

  it('copies the frame in picture units where either step has no faces', () => {
    const older = craneStep('S.none', { faces: false });
    const area = headArea(craneStep('S.none'), 'none');
    for (const [s, n] of [
      [withArea(older, area), renamed(craneStep('C.none'), 'step-n')],
      [withArea(craneStep('S.none'), area), renamed(craneStep('C.none', { faces: false }), 'step-n')],
    ] as const) {
      const captured = capture(diagramOf(s, n), 'step-n')!;
      expect(captured).toMatchObject({ placed: 'picture', anchor: 'none' });
      expect(captured.zoom.frame).toEqual(zoomOutlineOf(area));
    }
  });

  it('copies the frame of an enlarged step whose picture has no faces, not an imprint it keeps from its own capture', () => {
    const s = withArea(craneStep('S.affine'), headArea(craneStep('S.affine'), 'affine'));
    const n = renamed(craneStep('C.affine', { faces: false }), 'step-n');
    const document = enlargeStep(diagramOf(s, n), 'step-n', NO_ASSETS).document;
    // N keeps S's imprint, for a picture with faces to land; it shows the area copied in picture units.
    expect(zoomOf(document, 'step-n')!.imprint).toBeDefined();
    const after = insertSteps(document, [renamed(craneStep('C.affine'), 'step-m')], 2);
    const captured = capture(after, 'step-m')!;
    expect(captured).toMatchObject({ placed: 'picture', anchor: 'none' });
    expect(captured.zoom.frame).toEqual(zoomOf(document, 'step-n')!.frame);
    expect(captured.zoom.imprint).toBeUndefined();
  });
});

describe('a crease pattern’s one face', () => {
  const segmentation = twoSquaresSegmentation();
  const [left] = resolveCpSegments(segmentation);
  const scope = { kind: 'segment' as const, region: regionReferenceFor(left!) };

  async function patternStep(render: DiagramCpRender): Promise<DiagramStep> {
    const result = await captureStep(fakeCaptureRuntime(), { document: cpDocument(), segmentation, scope, render, style: DEFAULT_DIAGRAM_STYLE });
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('expected a picture');
    return { ...cpStep('step-cp', render, result.captured.picture), source: result.source };
  }

  it('is the paper about its centre, placed as the pattern is drawn — mirrored from the back', async () => {
    for (const side of ['front', 'back'] as const) {
      const step = await patternStep({ mode: 'crease-pattern', rotationDeg: 30, ...(side === 'back' ? { side } : {}) });
      const faces = paperFacesOf(step)!;
      expect(faces.kind).toBe('crease-pattern');
      // The left square, 100 units, about its centre.
      const xs = faces.paper[0]!.map(([x]) => x);
      // To the stored scene's step, turned back.
      expect(Math.min(...xs)).toBeCloseTo(-50, 2);
      expect(Math.max(...xs)).toBeCloseTo(50, 2);
      const placement = facePlacement(faces, 0)!;
      expect(placement.reflected).toBe(side === 'back');
      faces.paper[0]!.forEach((corner, index) => expect(distance(placement.apply(corner), faces.unspread[0]![index]!)).toBeLessThan(1e-9));
    }
  });

  it('copies the frame in picture units onto a step whose paper does not hold the anchor’s point, keeping the imprint', async () => {
    // Picked on the crane's sheet, far past the 100-unit square's.
    const crane = craneStep('S.none');
    const s = withArea(crane, headArea(crane, 'none', 'area-head', { anchor: paperFacesOf(crane)!.paper[33]![0]! }));
    const n = { ...(await patternStep({ mode: 'crease-pattern', rotationDeg: 0 })), id: 'step-n' };
    const captured = capture(diagramOf(s, n), 'step-n')!;
    expect(captured).toMatchObject({ placed: 'picture', anchor: 'none' });
    expect(captured.zoom.frame).toEqual(zoomOutlineOf(s.annotations[0] as KnownDiagramAnnotation));
    expect(captured.zoom.imprint).toMatchObject({ picked: true });
    // Landed again on its own picture, it stays where it is.
    const placed = { ...n, zoom: captured.zoom };
    expect(relandFrame(placed)).toBe(placed);
  });

  it('anchors a frame drawn on it at the frame’s centre on the paper, and lands it through the sheet', async () => {
    const step = await patternStep({ mode: 'crease-pattern', rotationDeg: 30 });
    const faces = paperFacesOf(step)!;
    const frame = { centre: [0.4, 0.45] as PicturePoint, radius: 0.1 };
    const anchor = anchorOf(faces, toScene(faces, frame))!;
    expect(anchor.face).toBe(0);
    expect(distance(facePlacement(faces, 0)!.apply(anchor.on), toScene(faces, frame).centre)).toBeLessThan(1e-9);
    const area: KnownDiagramAnnotation = { id: 'area-cp', kind: 'zoom', from: frame.centre, to: frame.centre, radius: 0.1 };
    const turned = await patternStep({ mode: 'crease-pattern', rotationDeg: 120, side: 'back' });
    const captured = capture(diagramOf(withArea(step, area), { ...turned, id: 'step-turned' }), 'step-turned')!;
    expect(captured.placed).toBe('sheet');
    // The same paper under it, turned and turned over with the sheet.
    const there = paperFacesOf({ ...turned, id: 'step-turned' })!;
    const centre = toScene(there, captured.zoom.frame!).centre;
    expect(distance(facePlacement(there, 0)!.invert(centre), anchor.on)).toBeLessThan(1e-9);
  });
});

describe('what a capture leaves alone', () => {
  const s = withArea(craneStep('S.affine'), headArea(craneStep('S.affine'), 'affine'));
  const enlarged = () => enlargeStep(diagramOf(s, renamed(craneStep('C.affine'), 'step-n')), 'step-n', NO_ASSETS).document;

  it('changes no captured frame when steps are moved', () => {
    const document = enlarged();
    const moved = moveStep(document, 'step-n', 0);
    expect(zoomOf(moved, 'step-n')).toBe(zoomOf(document, 'step-n'));
  });

  it('changes no enlarged step when the area or its step is deleted or edited', () => {
    const document = enlarged();
    const zoom = zoomOf(document, 'step-n');
    expect(zoomOf(removeSteps(document, [s.id]), 'step-n')).toBe(zoom);
    expect(zoomOf(editStepAnnotations(document, s.id, () => []), 'step-n')).toBe(zoom);
    const grown = editStepAnnotations(document, s.id, (marks) => marks.map((mark) => ({ ...mark, radius: 0.3 })));
    expect(zoomOf(grown, 'step-n')).toBe(zoom);
  });

  it('Update captures again exactly the steps with the area’s provenance, from the area, wherever they sit, over a hand move', () => {
    let document = enlarged();
    document = insertSteps(document, [renamed(craneStep('C.depth'), 'step-other')], 2);
    document = { ...document, steps: document.steps.map((entry) => (entry.id === 'step-other' ? { ...entry, zoom: { from: 'area-elsewhere', shape: 'circle' as const, frame: { centre: [0.5, 0.5] as PicturePoint, radius: 0.1 } } } : entry)) };
    document = moveStep(document, 'step-n', 0);
    const captured = zoomOf(document, 'step-n')!;
    const moved = setFrameOutline(document, 'step-n', { ...captured.frame!, centre: [0.2, 0.2] }, NO_ASSETS);
    expect(zoomOf(moved, 'step-n')!.frame!.centre).not.toEqual(captured.frame!.centre);
    expect(stepsFrom(moved, 'area-head')).toEqual(['step-n']);
    // Moved before its area's step, it is captured again all the same: from the area, as it is now.
    const updated = updateEnlargedSteps(moved, 'area-head', NO_ASSETS);
    expect(updated.captured).toHaveLength(1);
    expect(zoomOf(updated.document, 'step-n')).toEqual(captured);
    expect(zoomOf(updated.document, 'step-other')).toBe(zoomOf(moved, 'step-other'));
    // The area's step, and the area, as they were; with the area gone, Update has nothing to capture from.
    expect(stepById(updated.document, s.id)).toBe(stepById(moved, s.id));
    expect(updateEnlargedSteps(removeSteps(moved, [s.id]), 'area-head', NO_ASSETS).captured).toEqual([]);
  });

  it('Update captures from its own area a step since moved after another area, keeping its provenance', () => {
    const other = withArea(renamed(craneStep('S.none'), 'step-b'), { id: 'area-b', kind: 'zoom', from: [0.2, 0.2], to: [0.2, 0.2], radius: 0.05 });
    let document = insertSteps(enlarged(), [other], 2);
    // Zach's reorder: the enlarged step dragged to after another step with an area.
    document = moveStep(document, 'step-n', 2);
    expect(document.steps.map((entry) => entry.id)).toEqual([s.id, 'step-b', 'step-n']);
    const updated = updateEnlargedSteps(document, 'area-head', NO_ASSETS).document;
    expect(zoomOf(updated, 'step-n')!.from).toBe('area-head');
    expect(stepsFrom(updated, 'area-head')).toEqual(['step-n']);
    // From the area, as a capture right after its step would place it: not from area-b, before it now.
    expect(zoomOf(updated, 'step-n')).toEqual(zoomOf(enlarged(), 'step-n'));
  });

  it('turned off and on, captures from what is before the step now', () => {
    const other = withArea(renamed(craneStep('S.none'), 'step-s2'), headArea(craneStep('S.none'), 'none', 'area-two'));
    let document = insertSteps(enlarged(), [other], 0);
    document = moveStep(document, 'step-n', 1);
    expect(zoomOf(document, 'step-n')!.from).toBe('area-head');
    document = unenlargeStep(document, 'step-n', NO_ASSETS);
    expect(zoomOf(document, 'step-n')).toBeUndefined();
    document = enlargeStep(document, 'step-n', NO_ASSETS).document;
    expect(zoomOf(document, 'step-n')!.from).toBe('area-two');
  });
});

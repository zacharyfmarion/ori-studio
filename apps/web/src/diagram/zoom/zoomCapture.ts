/**
 * Capturing an enlarged step's frame (Revision 2, Z2, Z7, Z8): from the
 * nearest earlier step with an area or a frame, at one moment, onto a step
 * that owns it from then on. Nothing here is a live link: a capture reads the
 * diagram as it is and returns what the step would store, and the step's
 * provenance — the area's id — is only ever read to say where it came from
 * and which steps Update Enlarged Steps captures again.
 *
 * Pure: no store. The verbs that store a capture are in `zoomFrames.ts`.
 */
import { PICTURE_REACH, withinReach, type PicturePoint } from '../annotate/annotationModel';
import {
  isKnownAnnotation,
  isLockedStep,
  isTurn,
  stepById,
  stepIndex,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepZoom,
  type DiagramZoomEdge,
  type DiagramZoomOutline,
  type DiagramZoomShape,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import {
  anchorPoint,
  defaultAnchor,
  faceAt,
  facePlacement,
  imprintFrame,
  landFrame,
  offSpread,
  paperFacesOf,
  toPicture,
  toScene,
  type StepFaces,
} from './zoomImprint';
import { zoomOutlineOf, zoomShapeOf } from './zoomModel';

/** An enlarged step's stored imprint: the frame on the paper, and the anchor's point there. */
export type ZoomImprint = NonNullable<DiagramStepZoom['imprint']>;

/** Where a capture is taken from: an area drawn on an earlier step, or an earlier enlarged step's frame. */
export type ZoomSource =
  { step: DiagramStep; area: KnownDiagramAnnotation } | { step: DiagramStep; zoom: DiagramStepZoom };

/** A step's enlarge areas, in their order. */
export function zoomAreas(step: DiagramStep): KnownDiagramAnnotation[] {
  return step.annotations.filter(
    (annotation): annotation is KnownDiagramAnnotation => isKnownAnnotation(annotation) && annotation.kind === 'zoom'
  );
}

/**
 * The step a capture onto `stepId` is taken from: the nearest earlier one
 * that holds an area — its first, in its annotations' order — or is enlarged,
 * turns passed and a newer build's locked step passed over. Null when there
 * is none.
 */
export function captureSource(document: DiagramDocument, stepId: string): ZoomSource | null {
  for (let index = stepIndex(document, stepId) - 1; index >= 0; index -= 1) {
    const entry = document.steps[index]!;
    if (isTurn(entry) || isLockedStep(entry)) continue;
    if (entry.zoom) return { step: entry, zoom: entry.zoom };
    const [area] = zoomAreas(entry);
    if (area) return { step: entry, area };
  }
  return null;
}

/**
 * The area with this id and the step it is on: what Update Enlarged Steps
 * captures from (Z7), wherever the steps it enlarged now sit. Null when the
 * area is gone, or is on a newer build's locked step.
 */
export function areaSource(document: DiagramDocument, areaId: string): ZoomSource | null {
  for (const entry of document.steps) {
    if (isTurn(entry) || isLockedStep(entry)) continue;
    const area = zoomAreas(entry).find((each) => each.id === areaId);
    if (area) return { step: entry, area };
  }
  return null;
}

/** What a capture takes from its source, besides where the frame lies. */
interface SourceFrame {
  from: string;
  shape: DiagramZoomShape;
  scale?: number;
  edge?: DiagramZoomEdge;
  /** The frame in its step's picture units: on an enlarged step with no picture yet, the one it copied. */
  frame?: DiagramZoomOutline;
  /** A picked anchor, copied by every capture. */
  picked?: PicturePoint;
  /** An enlarged step's stored imprint, for one with no picture to imprint from. */
  imprint?: ZoomImprint;
}

function sourceFrame(source: ZoomSource): SourceFrame {
  if ('area' in source) {
    const { area } = source;
    const frame = zoomOutlineOf(area);
    return {
      from: area.id,
      shape: zoomShapeOf(frame),
      frame,
      ...(area.scale !== undefined ? { scale: area.scale } : {}),
      ...(area.edge !== undefined ? { edge: area.edge } : {}),
      ...(area.anchor !== undefined ? { picked: area.anchor } : {}),
    };
  }
  const { zoom } = source;
  return {
    from: zoom.from,
    shape: zoom.shape,
    ...(zoom.frame ? { frame: zoom.frame } : {}),
    ...(zoom.scale !== undefined ? { scale: zoom.scale } : {}),
    ...(zoom.edge !== undefined ? { edge: zoom.edge } : {}),
    ...(zoom.imprint?.picked ? { picked: zoom.imprint.on } : {}),
    ...(zoom.imprint ? { imprint: zoom.imprint } : {}),
  };
}

/**
 * The anchor of a frame drawn on a step whose faces are `faces` (the frame in
 * scene px, as drawn): a picked point's face, when its paper holds it; else a
 * crease pattern's one face at the frame's centre on the paper; else the
 * default rule's face at its pole. Null with no face to anchor to.
 */
export function anchorOf(
  faces: StepFaces,
  drawn: DiagramZoomOutline,
  picked?: PicturePoint
): { face: number; on: PicturePoint; picked: boolean } | null {
  const pickedFace = picked ? faceAt(faces, picked) : null;
  if (picked && pickedFace !== null) return { face: pickedFace, on: [picked[0], picked[1]], picked: true };
  if (faces.kind === 'crease-pattern') {
    const placement = facePlacement(faces, 0);
    return placement
      ? {
          face: 0,
          on: placement.invert(offSpread(faces, drawn.centre)),
          picked: false,
        }
      : null;
  }
  const face = defaultAnchor(faces, drawn);
  const on = face === null ? null : anchorPoint(faces, face);
  return face === null || !on ? null : { face, on, picked: false };
}

/**
 * Steps 1–3 of a capture: a frame on its step (picture units) imprinted on
 * the paper through its anchor face, with the anchor's point. Null when the
 * step has no faces.
 */
export function imprintOn(step: DiagramStep, frame: DiagramZoomOutline, picked?: PicturePoint): ZoomImprint | null {
  const faces = paperFacesOf(step);
  if (!faces) return null;
  const drawn = toScene(faces, frame);
  const anchor = anchorOf(faces, drawn, picked);
  const imprint = anchor && imprintFrame(faces, anchor.face, drawn);
  if (!anchor || !imprint) return null;
  return {
    ...imprint,
    on: anchor.on,
    ...(anchor.picked ? { picked: true as const } : {}),
  };
}

/**
 * Where a capture's frame is imprinted from on its source step: its frame
 * imprinted afresh through its anchor face, on a step with faces; the imprint
 * it holds, on an enlarged step with no picture yet, whose frame beside it is
 * only what it copied. None on a step whose picture has no faces: its frame,
 * as it shows it, is copied in picture units ("Where faces are missing").
 */
function sourceImprint(step: DiagramStep, taken: SourceFrame): ZoomImprint | undefined {
  if (!step.picture) return taken.imprint;
  return (taken.frame && imprintOn(step, taken.frame, taken.picked)) || undefined;
}

/**
 * How a capture placed its frame: through an anchor face (`face`), through a
 * crease pattern's sheet (`sheet`), copied in picture units (`picture`), or
 * not yet, on a step with no picture (null).
 */
export type ZoomPlaced = 'face' | 'sheet' | 'picture' | null;

/**
 * A frame as a step stores it: its centre within reach, where the file
 * reader takes it as this build's — a frame landed far off its picture, by an
 * anchor far from what it frames, is held at reach's edge as an area is.
 */
export function heldFrame(frame: DiagramZoomOutline): DiagramZoomOutline {
  const centre = withinReach(frame.centre, PICTURE_REACH);
  return centre[0] === frame.centre[0] && centre[1] === frame.centre[1] ? frame : { ...frame, centre };
}

/**
 * An imprint landed on a step's picture, in its picture units, and how; the
 * frame copied in picture units where the step has no faces, or its paper
 * does not hold the anchor's point. A step with no picture yet keeps the
 * copy, for a first picture the imprint cannot land on.
 */
export function placeOn(
  step: DiagramStep,
  imprint: ZoomImprint | undefined,
  copied: DiagramZoomOutline | undefined
): { frame: DiagramZoomOutline | undefined; placed: ZoomPlaced } {
  if (!step.picture) return { frame: copied, placed: null };
  const faces = paperFacesOf(step);
  const landed = faces && imprint ? landFrame(faces, imprint, imprint.on) : null;
  if (faces && landed)
    return {
      frame: heldFrame(toPicture(faces, landed)),
      placed: faces.kind === 'crease-pattern' ? 'sheet' : 'face',
    };
  return { frame: copied, placed: 'picture' };
}

/** A capture: what the step would store, how its frame was placed, and its anchor. */
export interface ZoomCaptured {
  zoom: DiagramStepZoom;
  placed: ZoomPlaced;
  anchor: 'auto' | 'picked' | 'none';
}

/**
 * The frame a step would get if it were enlarged now (Z2): captured from
 * `source` — {@link captureSource} unless said, the nearest earlier step with
 * an area or a frame — imprinted on the paper through its anchor face there,
 * landed through the face of this step's paper that holds the anchor's point,
 * then onto its spread; with the source's shape, Size, Edge, a picked anchor,
 * and its provenance: an area's id, or an enlarged step's own. A step with no
 * picture yet keeps the imprint for its first picture to land, and the frame
 * copied for one it cannot land on; where either step has no faces, the frame
 * is copied in picture units. Null for a step that is gone, locked, or the
 * source itself, or has nothing to capture from.
 */
export function capture(
  document: DiagramDocument,
  stepId: string,
  source: ZoomSource | null = captureSource(document, stepId)
): ZoomCaptured | null {
  const step = stepById(document, stepId);
  if (!step || isLockedStep(step) || !source || source.step.id === stepId) return null;
  const taken = sourceFrame(source);
  const imprint = sourceImprint(source.step, taken);
  const { frame, placed } = placeOn(step, imprint, taken.frame);
  const zoom: DiagramStepZoom = {
    from: taken.from,
    shape: taken.shape,
    ...(frame ? { frame } : {}),
    ...(imprint ? { imprint } : {}),
    ...(taken.scale !== undefined ? { scale: taken.scale } : {}),
    ...(taken.edge !== undefined ? { edge: taken.edge } : {}),
  };
  const anchor = placed === 'face' || placed === 'sheet' ? (imprint?.picked ? 'picked' : 'auto') : 'none';
  return { zoom, placed, anchor };
}

/**
 * The steps Update Enlarged Steps captures again for an area (Z7): every step
 * with its provenance, wherever it sits now, in the diagram's order.
 */
export function stepsFrom(document: DiagramDocument, areaId: string): string[] {
  return document.steps.filter((entry) => !isTurn(entry) && entry.zoom?.from === areaId).map((entry) => entry.id);
}

/**
 * What a new step starts with (Z2, "yeah sounds right"): enlarged, captured
 * at creation, when the step before it — turns passed — is enlarged. A step
 * made with its picture — an upload, a References card — has its frame
 * landed at once; an empty one keeps the imprint for its first picture to
 * land, and the frame copied in picture units for a first picture with no
 * faces (`placed` null until then). Null otherwise.
 */
export function seededCapture(document: DiagramDocument, stepId: string): ZoomCaptured | null {
  for (let index = stepIndex(document, stepId) - 1; index >= 0; index -= 1) {
    const entry = document.steps[index]!;
    if (isTurn(entry)) continue;
    return entry.zoom ? capture(document, stepId) : null;
  }
  return null;
}

/** What a new step starts with: {@link seededCapture}'s frame. */
export function seededZoom(document: DiagramDocument, stepId: string): DiagramStepZoom | null {
  return seededCapture(document, stepId)?.zoom ?? null;
}

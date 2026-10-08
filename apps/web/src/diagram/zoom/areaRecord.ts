/**
 * What an enlarged step recorded of its area (review fix 4,
 * `implementation-plans/diagram-review-fixes.md`): the area's outline, picked
 * anchor, Size and Edge when the step's frame was captured from it
 * (`DiagramStepZoom.areaWas`, `areaWasOf`), told against the area as it is
 * now, and kept in step with an area its own step's picture carried.
 *
 * Only a hand edit of the area — moved, resized, reshaped, re-anchored, its
 * Size or Edge changed — leaves a record behind it. A re-pose of the area's
 * step carries the area with its picture (`annotationCarry.ts`), over the same
 * paper, so the records placed as it was go with it in the same edit
 * ({@link followAreaRecords}). A step with no record — a file's from before
 * records — is given one at the first hand edit of its area
 * ({@link recordAreaBeforeEdit}), so that edit says it is out of date.
 *
 * Pure: no store. Lean on purpose, as the document's own edits call it.
 */
import {
  isLockedStep,
  isTurn,
  stepById,
  type DiagramDocument,
  type DiagramStepZoom,
  type DiagramZoomAreaWas,
  type DiagramZoomOutline,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { areaWasOf, zoomAreas } from './zoomCapture';
import { zoomEdgeOf, zoomShapeOf } from './zoomModel';

/** Whether two numbers are one, but for float noise. */
function near(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function sameOutline(a: DiagramZoomOutline, b: DiagramZoomOutline): boolean {
  return (
    near(a.centre[0], b.centre[0]) &&
    near(a.centre[1], b.centre[1]) &&
    near(a.radius, b.radius) &&
    near(a.size?.[0], b.size?.[0]) &&
    near(a.size?.[1], b.size?.[1]) &&
    near(a.angle ?? 0, b.angle ?? 0)
  );
}

/**
 * Whether two records put the frame in one place: the same outline — its
 * centre, shape and size, and a rectangle's turn — and the same picked
 * anchor, or none. What a carry of the area by its picture moves.
 */
export function samePlace(a: DiagramZoomAreaWas, b: DiagramZoomAreaWas): boolean {
  if ((a.anchor === undefined) !== (b.anchor === undefined)) return false;
  const anchors = a.anchor === undefined || (near(a.anchor[0], b.anchor![0]) && near(a.anchor[1], b.anchor![1]));
  return anchors && sameOutline(a.outline, b.outline);
}

/** Whether two records are of one area as it was: placed alike, with the same Size and Edge. */
export function sameAreaWas(a: DiagramZoomAreaWas, b: DiagramZoomAreaWas): boolean {
  return samePlace(a, b) && a.scale === b.scale && a.edge === b.edge;
}

/**
 * Whether an enlarged step takes its Size, or its Edge, from its area: it
 * prints as it recorded the area printing. One set on the step since — in its
 * Enlarged section, or on its frame in Layers — is its own, which Update
 * keeps ({@link withOwnPrint}). Unsaid is Fill; an Edge is told by how it
 * draws, so Cut said on a circle's frame is the circle's own, unsaid.
 */
function takesScale(zoom: DiagramStepZoom, was: DiagramZoomAreaWas): boolean {
  return zoom.scale === was.scale;
}

/** How a recorded area draws its edge: the Edge said, or its shape's own. */
function recordedEdge(was: DiagramZoomAreaWas) {
  return zoomEdgeOf(zoomShapeOf(was.outline), was.edge);
}

function takesEdge(zoom: DiagramStepZoom, was: DiagramZoomAreaWas): boolean {
  return zoomEdgeOf(zoom.shape, zoom.edge) === recordedEdge(was);
}

/**
 * Whether the area changed for an enlarged step since its frame was captured
 * from it (`zoom.areaWas`), the area as it is now `now` (`areaWasOf`): moved,
 * resized, reshaped or re-anchored; or its Size or Edge changed where the step
 * still prints with the one it took. Exactly when Update would place the step
 * elsewhere or print it otherwise. A step with no record never has.
 */
export function areaChangedFor(zoom: DiagramStepZoom, now: DiagramZoomAreaWas): boolean {
  const was = zoom.areaWas;
  if (!was) return false;
  if (!samePlace(was, now)) return true;
  return (takesScale(zoom, was) && was.scale !== now.scale) || (takesEdge(zoom, was) && recordedEdge(was) !== recordedEdge(now));
}

/**
 * A capture's zoom for a step whose zoom was `was` (Update, Update All): the
 * frame, imprint, shape and record as captured from the area, and the step's
 * own Size and Edge kept where it set them — its record says what it took
 * from the area. A step with no record takes the area's, as Update Enlarged
 * Steps gave every step before records.
 */
export function withOwnPrint(was: DiagramStepZoom | undefined, captured: DiagramStepZoom): DiagramStepZoom {
  const record = was?.areaWas;
  if (!was || !record) return captured;
  const { scale: _scale, edge: _edge, ...rest } = captured;
  const scale = takesScale(was, record) ? captured.scale : was.scale;
  const edge = takesEdge(was, record) ? captured.edge : was.edge;
  return {
    ...rest,
    ...(scale !== undefined ? { scale } : {}),
    ...(edge !== undefined ? { edge } : {}),
  };
}

/** The steps of `document` enlarged from these areas, their zoom given by `edit`; `document` when none changes. */
function editZooms(
  document: DiagramDocument,
  areaIds: ReadonlySet<string>,
  edit: (zoom: DiagramStepZoom) => DiagramStepZoom
): DiagramDocument {
  let steps: DiagramDocument['steps'] | null = null;
  document.steps.forEach((entry, index) => {
    if (isTurn(entry) || isLockedStep(entry) || !entry.zoom || !areaIds.has(entry.zoom.from)) return;
    const zoom = edit(entry.zoom);
    if (zoom === entry.zoom) return;
    steps ??= document.steps.slice();
    steps[index] = { ...entry, zoom };
  });
  return steps ? { ...document, steps } : document;
}

/** The areas on a step in one diagram, and by id in the next; null when the step did not change. */
function areasAcross(
  before: DiagramDocument,
  after: DiagramDocument,
  stepId: string
): { was: KnownDiagramAnnotation[]; now: Map<string, KnownDiagramAnnotation> } | null {
  if (before === after) return null;
  const [was, now] = [stepById(before, stepId), stepById(after, stepId)];
  if (!was || !now || was === now) return null;
  return { was: zoomAreas(was), now: new Map(zoomAreas(now).map((area) => [area.id, area])) };
}

/**
 * The records of the enlarged steps an area on `stepId` was captured onto,
 * kept in step with it across an edit of that step's own picture — a
 * re-pose, a refresh, a relink, an upload turned — `before` to `after`: each
 * placed as the area was before the edit records its place after, its Size
 * and Edge as they were, so an area its picture carried says nothing is out
 * of date. A record placed elsewhere — the area moved by hand first — stays
 * as it was, still out of date. `after` as it is when no area on the step
 * moved, or no record followed it.
 */
export function followAreaRecords(before: DiagramDocument, after: DiagramDocument, stepId: string): DiagramDocument {
  const areas = areasAcross(before, after, stepId);
  if (!areas) return after;
  const carried = new Map<string, { from: DiagramZoomAreaWas; to: DiagramZoomAreaWas }>();
  for (const area of areas.was) {
    const next = areas.now.get(area.id);
    if (!next) continue;
    const [from, to] = [areaWasOf(stepId, area), areaWasOf(stepId, next)];
    if (!samePlace(from, to)) carried.set(area.id, { from, to });
  }
  if (carried.size === 0) return after;
  return editZooms(after, new Set(carried.keys()), (zoom) => {
    const carry = carried.get(zoom.from)!;
    if (!zoom.areaWas || !samePlace(zoom.areaWas, carry.from)) return zoom;
    const { outline, anchor } = carry.to;
    const { anchor: _anchor, ...rest } = zoom.areaWas;
    return { ...zoom, areaWas: { ...rest, outline, ...(anchor !== undefined ? { anchor } : {}) } };
  });
}

/**
 * A hand edit of the marks on `stepId`, `before` to `after`, that changed an
 * area — moved, resized, reshaped, re-anchored, its Size or Edge changed, or
 * deleted — recorded on each step enlarged from it that holds no record — a
 * file's from before records — as the area was just before the edit: the edit
 * makes such a step out of date, whatever it was before, so it says so as a
 * step that recorded its area does. A step with a record keeps it. In the
 * edit's own undo step. `after` as it is when no area changed, or every step
 * from it has a record.
 */
export function recordAreaBeforeEdit(before: DiagramDocument, after: DiagramDocument, stepId: string): DiagramDocument {
  const areas = areasAcross(before, after, stepId);
  if (!areas) return after;
  const edited = new Map<string, DiagramZoomAreaWas>();
  for (const area of areas.was) {
    const was = areaWasOf(stepId, area);
    const next = areas.now.get(area.id);
    if (!next || !sameAreaWas(was, areaWasOf(stepId, next))) edited.set(area.id, was);
  }
  if (edited.size === 0) return after;
  return editZooms(after, new Set(edited.keys()), (zoom) => (zoom.areaWas ? zoom : { ...zoom, areaWas: edited.get(zoom.from)! }));
}

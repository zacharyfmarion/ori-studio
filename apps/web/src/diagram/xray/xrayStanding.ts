/**
 * Whether a step's picture can be x-rayed, and what to say where it cannot
 * (Revision 3, R3-18a A, R3-18b A): the X-Ray tool held on the rail, its key
 * picking nothing, and an x-ray's Depth row disabled, each with the reason.
 *
 * A flat fold captured before its faces on the paper were kept (Revision 2)
 * gets them while its link to its pattern is current: folded again as an
 * x-ray is laid, in the same undo step (`stepWithPaperFaces`, as an enlarge
 * area's step gets them). Where that cannot be — the link is stale or its
 * pattern gone, or no pattern is open to fold — Refresh is the way.
 *
 * Pure: the link's status is the caller's to tell.
 */
import type { XRayStanding } from '../annotate/annotateTools';
import type { DiagramLinkStatus } from '../capture/linkStatus';
import { lacksPaperFaces } from '../capture/stepPaperFaces';
import type { DiagramStep } from '../document/diagramDocument';
import { xrayFacesOf } from './xrayScene';

/**
 * A step's x-ray standing ({@link XRayStanding}): `ready` with its faces;
 * `fetch` for a flat fold without them whose pattern is open and link not
 * known to be out of date — a link still being checked is folded and checked
 * as the faces are fetched; `refresh`, numbered `number`, for one whose link
 * is stale or missing, or with no pattern open; `none` for any other picture.
 */
export function xrayStanding(
  step: DiagramStep,
  { link, patternOpen, number }: { link: DiagramLinkStatus | null; patternOpen: boolean; number: number }
): XRayStanding {
  if (xrayFacesOf(step)) return { kind: 'ready' };
  if (!lacksPaperFaces(step)) return { kind: 'none' };
  return patternOpen && (link === 'current' || link === 'unknown') ? { kind: 'fetch' } : { kind: 'refresh', number };
}

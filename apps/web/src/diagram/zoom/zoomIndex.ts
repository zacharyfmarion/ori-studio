/**
 * What the diagram's order says about its enlarged steps (Revision 2),
 * derived once per order and never stored: which steps each area has been
 * enlarged on — by their provenance, wherever they sit — and, before each
 * enlarged step, the area an enlarge arrow leaves, if one prints there.
 *
 * Pure: a memo per order (WeakMap), as step numbers are.
 */
import { isTurn, type DiagramEntry } from '../document/diagramDocument';
import { zoomAreas } from './zoomCapture';

/** The area an enlarge arrow leaves: on which step, and which area there. */
export interface ZoomArrowFrom {
  stepId: string;
  areaId: string;
}

export interface ZoomIndex {
  /** Per area id, the enlarged steps with that provenance, in order. */
  stepsByArea: ReadonlyMap<string, readonly string[]>;
  /** Per enlarged step, the area the arrow before it leaves; null where none prints. */
  arrowFrom: ReadonlyMap<string, ZoomArrowFrom | null>;
}

const indexes = new WeakMap<readonly DiagramEntry[], ZoomIndex>();

/**
 * The index of a diagram's order. An arrow prints before an enlarged step
 * when the step before it, turns passed, holds an area: it leaves the area
 * the enlarged step was captured from, when that step holds it, else that
 * step's first. It reads the order as it is, so after a move it prints
 * wherever the rule now holds — nothing about it is stored.
 */
export function zoomIndex(document: { steps: readonly DiagramEntry[] }): ZoomIndex {
  const known = indexes.get(document.steps);
  if (known) return known;
  const stepsByArea = new Map<string, string[]>();
  const arrowFrom = new Map<string, ZoomArrowFrom | null>();
  let previous: DiagramEntry | null = null;
  for (const entry of document.steps) {
    if (isTurn(entry)) continue;
    if (entry.zoom) {
      const list = stepsByArea.get(entry.zoom.from) ?? [];
      list.push(entry.id);
      stepsByArea.set(entry.zoom.from, list);
      const areas = previous && !isTurn(previous) ? zoomAreas(previous) : [];
      const left = areas.find((area) => area.id === entry.zoom!.from) ?? areas[0];
      arrowFrom.set(entry.id, left && previous ? { stepId: previous.id, areaId: left.id } : null);
    }
    previous = entry;
  }
  const index: ZoomIndex = { stepsByArea, arrowFrom };
  indexes.set(document.steps, index);
  return index;
}

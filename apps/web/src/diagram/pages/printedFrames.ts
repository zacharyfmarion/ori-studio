import { useEffect, useSyncExternalStore } from 'react';
import { stepsOf, type DiagramDocument } from '../document/diagramDocument';
import type { LayoutCell } from './diagramPageLayout';
import type { PreparedDiagramPages } from './diagramPages';
import { printedFrameMm } from './pagePictures';

/**
 * The size each step's picture frame prints at on the pages, by step, in mm
 * across its longer side: what a mark's print sizes are judged at in another
 * pane — equal divisions' ticks crowding on a step printed small (Revision 2,
 * ED10) — as the Steps grid reads the cards' text-cut flags from the same
 * layout. The Diagram panel lays the pages out and publishes them here; the
 * Layers pane, a dock panel of its own, reads them.
 */
export type PrintedFrames = ReadonlyMap<string, number>;

/**
 * Each enlarged step's size against the area it enlarges, as the pages lay
 * it out (Revision 2, `LayoutCell.zoom`): what the Layers pane's and the Step
 * pane's read-outs say — "prints ×4.4", or "asked ×3 · prints ×2.4".
 */
export type PrintedZoom = NonNullable<LayoutCell['zoom']>;
export type PrintedZooms = ReadonlyMap<string, PrintedZoom>;

const NONE: PrintedFrames = new Map();
const NO_ZOOMS: PrintedZooms = new Map();
let current: PrintedFrames = NONE;
let currentZooms: PrintedZooms = NO_ZOOMS;
const listeners = new Set<() => void>();

/** Each step's printed frame size in a layout of `document`'s pages. */
export function printedFrames(pages: PreparedDiagramPages | null, document: DiagramDocument | null): PrintedFrames {
  if (!pages || !document) return NONE;
  const steps = new Map(stepsOf(document).map((step) => [step.id, step]));
  const sizes = new Map<string, number>();
  for (const page of pages.layout.pages) {
    for (const cell of page.cells) {
      const step = steps.get(cell.stepId);
      const mm = step ? printedFrameMm(step, document.assets, document.style, cell) : null;
      if (mm !== null) sizes.set(cell.stepId, mm);
    }
  }
  return sizes.size > 0 ? sizes : NONE;
}

/** Each enlarged step's read-out in a layout of the pages (Revision 2). */
export function printedZooms(pages: PreparedDiagramPages | null): PrintedZooms {
  if (!pages) return NO_ZOOMS;
  const zooms = new Map<string, PrintedZoom>();
  for (const page of pages.layout.pages) for (const cell of page.cells) if (cell.zoom) zooms.set(cell.stepId, cell.zoom);
  return zooms.size > 0 ? zooms : NO_ZOOMS;
}

function publish(next: PrintedFrames, nextZooms: PrintedZooms = NO_ZOOMS): void {
  if (next === current && nextZooms === currentZooms) return;
  current = next;
  currentZooms = nextZooms;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => current;
const readZooms = () => currentZooms;

/**
 * Publish the printed frames of `pages`, laid out from `document`, while the
 * caller is mounted: the Diagram panel, which lays the pages out.
 */
export function usePublishPrintedFrames(pages: PreparedDiagramPages | null, document: DiagramDocument | null): void {
  useEffect(() => {
    // Laid out from the document it is: a layout of an earlier one says nothing of it.
    publish(printedFrames(pages, document), pages && document ? printedZooms(pages) : NO_ZOOMS);
  }, [pages, document]);
  useEffect(() => () => publish(NONE), []);
}

/** The size step `stepId`'s picture frame prints at, in mm; null before the pages are laid out, or for a step with no picture. */
export function usePrintedFrameMm(stepId: string | null): number | null {
  const frames = useSyncExternalStore(subscribe, read, read);
  return stepId === null ? null : (frames.get(stepId) ?? null);
}

/**
 * What enlarged step `stepId` prints at against the area it enlarges
 * (Revision 2): null before the pages are laid out, for a step that is not
 * enlarged, or one whose area's printed size is not known.
 */
export function usePrintedZoom(stepId: string | null): PrintedZoom | null {
  const zooms = useSyncExternalStore(subscribe, readZooms, readZooms);
  return stepId === null ? null : (zooms.get(stepId) ?? null);
}

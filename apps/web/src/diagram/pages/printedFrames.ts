import { useEffect, useSyncExternalStore } from 'react';
import { stepsOf, type DiagramDocument } from '../document/diagramDocument';
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

const NONE: PrintedFrames = new Map();
let current: PrintedFrames = NONE;
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

function publish(next: PrintedFrames): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => current;

/**
 * Publish the printed frames of `pages`, laid out from `document`, while the
 * caller is mounted: the Diagram panel, which lays the pages out.
 */
export function usePublishPrintedFrames(pages: PreparedDiagramPages | null, document: DiagramDocument | null): void {
  useEffect(() => {
    // Laid out from the document it is: a layout of an earlier one says nothing of it.
    publish(printedFrames(pages, document));
  }, [pages, document]);
  useEffect(() => () => publish(NONE), []);
}

/** The size step `stepId`'s picture frame prints at, in mm; null before the pages are laid out, or for a step with no picture. */
export function usePrintedFrameMm(stepId: string | null): number | null {
  const frames = useSyncExternalStore(subscribe, read, read);
  return stepId === null ? null : (frames.get(stepId) ?? null);
}

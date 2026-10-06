import { useEffect, useRef, type RefObject } from 'react';
import { observeResizeDeferred } from '../../components/ui/observeResizeDeferred';
import { onFieldFocusRequest, takeFieldFocus, type FocusField } from './fieldFocus';

/**
 * A field of the Layers pane that takes the focus when the canvas asks for it
 * (`fieldFocus.ts`): a label's text just put down, new equal divisions' Parts.
 * The ref goes on the field (`TextAreaRow`'s and `NumberRow`'s `fieldRef`).
 * It takes the request once it is in the page, its contents selected so what
 * is typed replaces them — 5 over 4 is 5, not 45 — and asks again each time
 * it is laid out: the Layers tab comes forward after the press that selected
 * the mark, and until then the dock keeps the pane mounted with its content
 * out of the page, where a focus does nothing. A sheet that opens with the
 * field in it — the Settings sheet on a touch screen — focuses itself once
 * its content has mounted, after the field took the focus: the field takes it
 * back on the next frame, from the sheet and only from it.
 */
export function useFieldFocusRequest<T extends HTMLInputElement | HTMLTextAreaElement>(
  annotationId: string,
  field: FocusField
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const focus = () => {
      element.focus();
      element.select();
    };
    const take = () => {
      if (!element.isConnected || !takeFieldFocus(annotationId, field)) return;
      focus();
      cancelAnimationFrame(frame);
      // Not cancelled as the effect is cleaned up: a remount — React's strict
      // mode runs every effect twice — finds the request spent, and the frame
      // is what still gives the field its focus back.
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (element.isConnected && active !== element && active instanceof Element && active.contains(element)) focus();
      });
    };
    take();
    const stop = onFieldFocusRequest((requested) => {
      if (requested.annotationId === annotationId && requested.field === field) take();
    });
    const unwatch = typeof ResizeObserver === 'undefined' ? () => {} : observeResizeDeferred(element, take);
    return () => {
      stop();
      unwatch();
    };
  }, [annotationId, field]);
  return ref;
}

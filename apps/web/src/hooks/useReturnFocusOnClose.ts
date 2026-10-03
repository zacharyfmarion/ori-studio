import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Hand the focus back when an inline surface that held it closes.
 *
 * Closing a picker or an inline editor unmounts the control under the focus,
 * and the page takes it: the next Tab starts from the top of the document. When
 * `open` turns false and the focus is on nothing, it goes to the element in
 * `container` that `selector` names — the control that opened the surface —
 * or, when that cannot take it, the container's first control that can. Focus
 * the user moved anywhere else is left where it is.
 */
export function useReturnFocusOnClose(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  selector: string
): void {
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    const root = container.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>(`${selector}:not(:disabled)`) ??
      root.querySelector<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]');
    target?.focus({ preventScroll: true });
  }, [open, container, selector]);
}

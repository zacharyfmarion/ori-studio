import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Keep keyboard focus inside a group of controls through an action that
 * disables, or re-mounts, the control it came from.
 *
 * A focused button that disables itself drops focus on the page — Reset turns
 * itself off the moment the pose is upright — and a keyboard user is sent back
 * to the top of the document. Wrap the action in `keep`: when focus was inside
 * the container and is not after the update, it goes to the container's first
 * control that can take it. Returns the container's ref and `keep`.
 */
export function useKeepFocusWithin<T extends HTMLElement>(): [
  RefObject<T | null>,
  (run: () => void) => void,
] {
  const ref = useRef<T | null>(null);
  const wasInside = useRef(false);

  // After every render, so whichever update the action caused is the one checked.
  useLayoutEffect(() => {
    if (!wasInside.current) return;
    wasInside.current = false;
    const container = ref.current;
    if (!container || container.contains(document.activeElement)) return;
    container
      .querySelector<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]')
      ?.focus({ preventScroll: true });
  });

  const keep = useCallback((run: () => void) => {
    wasInside.current = ref.current?.contains(document.activeElement) ?? false;
    run();
  }, []);

  return [ref, keep];
}

import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { usePhoneListDetail, type PhoneScreen } from '../../hooks/usePhoneListDetail';
import type { ReferencesBrowser } from './useReferencesBrowser';

export interface ReferencesBrowserPhoneFlow {
  /** The screen a phone shows, or null on any other layout, which shows both side by side. */
  screen: PhoneScreen | null;
  /** A press on a pattern: show its cards — on a phone, as the next screen. */
  openPattern: (id: string) => void;
  /** Back to the patterns, or null where there is no list to go back to. */
  back: (() => void) | null;
}

/**
 * The References browser on a phone (D17): its planned patterns as a list,
 * and a pattern's cards as a screen of their own with Back — the shape
 * References and Simulate take there (`usePhoneListDetail`).
 *
 * A list only when there is a choice: in Sequence, of two patterns or more.
 * One pattern, or Find, opens straight on the cards. Replace opens on the
 * cards of the pattern its step came from, once that is listed — by its plan,
 * or by its sheet when it has been planned again: that is what it was opened
 * to show.
 *
 * A press that changes the screen hides the button it was made on, so focus
 * goes where the press went: to the browser (`root`) on a pattern's cards —
 * its next Tab is ← Patterns — and back on the list, to the pattern just left.
 */
export function useReferencesBrowserPhoneFlow(
  browser: ReferencesBrowser,
  root: RefObject<HTMLElement | null>
): ReferencesBrowserPhoneFlow {
  const { state, patterns, patternNamed } = browser;
  const listed = patterns.status === 'ready' ? patterns.patterns : null;
  const flow = usePhoneListDetail({
    hasList: state.mode === 'sequence' && listed !== null && listed.length > 1,
    // A new set of patterns starts at the list again.
    revision: listed ? listed.map((entry) => entry.id).join('|') : patterns.status,
  });
  const { openDetail, back: backToList } = flow;
  const { choosePattern } = browser;
  const focusOn = useRef<PhoneScreen | null>(null);
  const openPattern = useCallback(
    (id: string) => {
      choosePattern(id);
      if (openDetail()) focusOn.current = 'detail';
    },
    [choosePattern, openDetail]
  );
  const back = useMemo(
    () =>
      backToList &&
      (() => {
        focusOn.current = 'list';
        backToList();
      }),
    [backToList]
  );
  useLayoutEffect(() => {
    if (focusOn.current === null || focusOn.current !== flow.screen) return;
    focusOn.current = null;
    const left = flow.screen === 'list' ? root.current?.querySelector<HTMLElement>('nav [aria-current="true"]') : null;
    (left ?? root.current)?.focus({ preventScroll: true });
  }, [flow.screen, root]);

  // Replace, once its pattern is listed: on its cards, once. Before paint, so
  // the render that lists the patterns never shows the list first.
  const opened = useRef(false);
  const ownPattern = state.anchor.kind === 'replace' && patternNamed;
  useLayoutEffect(() => {
    if (opened.current || !ownPattern) return;
    opened.current = true;
    openDetail();
  }, [ownPattern, openDetail]);

  return { screen: flow.screen, openPattern, back };
}

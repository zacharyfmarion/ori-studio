import { useCallback, useEffect, useRef } from 'react';
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
 * cards of the pattern its step came from, once that is listed: that is what
 * it was opened to show.
 */
export function useReferencesBrowserPhoneFlow(browser: ReferencesBrowser): ReferencesBrowserPhoneFlow {
  const { state, patterns, pattern } = browser;
  const listed = patterns.status === 'ready' ? patterns.patterns : null;
  const flow = usePhoneListDetail({
    hasList: state.mode === 'sequence' && listed !== null && listed.length > 1,
    // A new set of patterns starts at the list again.
    revision: listed ? listed.map((entry) => entry.id).join('|') : patterns.status,
  });
  const { openDetail } = flow;
  const { choosePattern } = browser;
  const openPattern = useCallback(
    (id: string) => {
      choosePattern(id);
      openDetail();
    },
    [choosePattern, openDetail]
  );

  // Replace, once its pattern is listed: on its cards, once.
  const opened = useRef(false);
  const ownPattern = state.anchor.kind === 'replace' && pattern !== null && pattern.id === state.pattern;
  useEffect(() => {
    if (opened.current || !ownPattern) return;
    opened.current = true;
    openDetail();
  }, [ownPattern, openDetail]);

  return { screen: flow.screen, openPattern, back: flow.back };
}

/**
 * The Simulate workspace on a phone: a list of the document's patterns, and
 * the simulator as a detail screen for one of them.
 *
 * The list/detail state is `usePhoneListDetail`, shared with References; what
 * is Simulate's own is when there is a list at all. The rail hides itself for a
 * document with one pattern on every layout — there is nothing to pick — so on
 * a phone that document opens straight on the simulator, with no Back, and so
 * does a document with none (whose overlay says why). A list appears only for
 * the document it exists for: two or more patterns.
 */
import { useCallback } from 'react';
import { ANALYTICS_EVENTS, track } from '../analytics';
import { usePhoneListDetail, type PhoneScreen } from '../hooks/usePhoneListDetail';

/** What the flow reads: the document's identity, and what there is to list. */
export interface SimulatorPhoneFlowView {
  /** How many patterns the document's fold splits into. */
  segments: number;
  /**
   * The simulation source's identity (`foldArtifactRevision`): bumped when the
   * document the simulator reads from changes, kept across a refresh of it.
   */
  revision: number;
}

/** Whether there is a list worth showing: only a choice of patterns is one. */
export function simulatorPhoneHasList(view: SimulatorPhoneFlowView): boolean {
  return view.segments > 1;
}

export interface SimulatorPhoneFlow {
  /**
   * The screen a phone shows, or `null` on any other layout — which shows the
   * rail and the simulator side by side, as it always has.
   */
  screen: PhoneScreen | null;
  /** A press on a card: make the pattern the simulator's and, on a phone, show it. */
  openSegment: (id: number) => void;
  /** Back to the list, or `null` where there is no list to go back to. */
  back: (() => void) | null;
}

/**
 * The phone flow, bound to the panel's own selection so a press means the same
 * thing on both layouts plus the navigation.
 */
export function useSimulatorPhoneFlow(
  view: SimulatorPhoneFlowView,
  selectSegment: (id: number) => void
): SimulatorPhoneFlow {
  const flow = usePhoneListDetail({
    hasList: simulatorPhoneHasList(view),
    revision: String(view.revision),
  });
  const { openDetail } = flow;
  const openSegment = useCallback(
    (id: number) => {
      selectSegment(id);
      if (openDetail()) track(ANALYTICS_EVENTS.simulatorPatternOpened);
    },
    [selectSegment, openDetail]
  );
  return { screen: flow.screen, openSegment, back: flow.back };
}

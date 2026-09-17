/**
 * The References workspace on a phone: a list of the document's patterns, and
 * a detail screen for one of them.
 *
 * The list/detail state is `usePhoneListDetail`, shared with Simulate; what is
 * References' own is when there is a list at all, and what a press means — a
 * card selects a sheet, and a finding in the notes selects itself and frames
 * itself on the canvas, which is on the detail. The list is where every visit
 * starts, even for a document with one sheet, because the list is also where
 * the notes and the findings are read.
 */
import { useCallback } from 'react';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import {
  phoneScreen,
  usePhoneListDetail,
  type PhoneScreen,
  type PhoneScreenChoice,
} from '../../hooks/usePhoneListDetail';
import type { ReferencesViewState } from './useReferencesView';

export type ReferencesPhoneScreen = PhoneScreen;

/** The screen last chosen, and the document it was chosen for. */
export type ReferencesPhoneChoice = PhoneScreenChoice;

/** What the flow reads: the document's identity, and what there is to list. */
export type ReferencesPhoneFlowView = Pick<ReferencesViewState, 'hasDocument' | 'revision'> & {
  /** How many patterns the list has to show. */
  sheets: number;
  /** The run failed — which the detail's overlay reports, and the list cannot. */
  failed: boolean;
};

/**
 * Whether there is a list worth showing.
 *
 * Without a document there is not: the list would be an empty header, while
 * the detail's own overlay says "No crease pattern" and offers the way to get
 * one. Nor when the run failed before it found a pattern to list — the
 * detail's overlay is where the error and its Recompute are. In both cases the
 * detail shows, with no Back, and the list takes over the moment the document
 * changes.
 */
export function referencesPhoneHasList(view: ReferencesPhoneFlowView): boolean {
  return view.hasDocument && (view.sheets > 0 || !view.failed);
}

/** Which screen the phone shows — `phoneScreen` under References' own list test. */
export function referencesPhoneScreen(
  choice: ReferencesPhoneChoice,
  view: ReferencesPhoneFlowView
): ReferencesPhoneScreen {
  return phoneScreen(choice, { hasList: referencesPhoneHasList(view), revision: view.revision });
}

export interface ReferencesPhoneFlow {
  /**
   * The screen a phone shows, or `null` on any other layout — which shows the
   * list and the detail side by side, as it always has. Non-null is the test
   * for "this is the phone References layout", the way `useDesignPaneSwitcher`'s
   * `panes` is for Design.
   */
  screen: ReferencesPhoneScreen | null;
  /** A press on a card: make the sheet the workspace's and, on a phone, show it. */
  openSheet: (component: number) => void;
  /**
   * A press on a finding in the notes: make it the active one and, on a phone,
   * show the detail — the finding frames itself on the canvas, and the canvas
   * is on the detail.
   */
  openFinding: (index: number | null) => void;
  /**
   * Back to the list, or `null` where there is no list to go back to: any
   * layout but the phone's, the list itself, and a phone whose detail is an
   * overlay the list cannot replace (`referencesPhoneHasList`).
   */
  back: (() => void) | null;
}

/** What a press does on every layout; the flow adds the navigation. */
export interface ReferencesPhoneFlowActions {
  /**
   * The panel's own — the one that resolves against the sheet already showing
   * so a press on the selected card does not wipe the plan.
   */
  selectSheet: (component: number) => void;
  selectFinding: (index: number | null) => void;
}

/**
 * The phone flow, bound to the panel.
 *
 * The flow calls the panel's actions rather than the store, so a press means
 * the same thing on both layouts plus the navigation.
 */
export function useReferencesPhoneFlow(
  view: ReferencesPhoneFlowView,
  actions: ReferencesPhoneFlowActions
): ReferencesPhoneFlow {
  const flow = usePhoneListDetail({
    hasList: referencesPhoneHasList(view),
    revision: view.revision,
  });
  const { openDetail } = flow;
  const { selectSheet, selectFinding } = actions;
  const showDetail = useCallback(
    (source: 'card' | 'finding') => {
      if (openDetail()) track(ANALYTICS_EVENTS.referencesPatternOpened, { source });
    },
    [openDetail]
  );
  const openSheet = useCallback(
    (component: number) => {
      selectSheet(component);
      showDetail('card');
    },
    [selectSheet, showDetail]
  );
  const openFinding = useCallback(
    (index: number | null) => {
      selectFinding(index);
      if (index !== null) showDetail('finding');
    },
    [selectFinding, showDetail]
  );
  return { screen: flow.screen, openSheet, openFinding, back: flow.back };
}

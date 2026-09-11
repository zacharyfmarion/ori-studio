/**
 * The References workspace on a phone: a list of the document's patterns, and
 * a detail screen for one of them.
 *
 * At 375px the desktop shape — a 260px rail beside the canvas — leaves the
 * crease pattern 115px, so the phone shows one of the two at a time and moves
 * between them the way the Design workspace's ExplOri panes do: a press on a
 * card opens the detail, and a Back button at the start of its toolbar returns
 * to the list. The list is where every visit starts, even for a document with
 * one sheet, because the list is also where the notes and the findings are read.
 *
 * Local state, not a store slice. The dock is cleared on every workspace switch
 * (`layoutStore.activateWorkspace`), so the panel unmounts and a return to
 * References starts on the list — which is the behaviour wanted, not a loss to
 * work around. Nothing outside the panel asks which screen is showing.
 */
import { useCallback, useState } from 'react';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import type { ReferencesViewState } from './useReferencesView';

export type ReferencesPhoneScreen = 'list' | 'detail';

/** The screen last chosen, and the document it was chosen for. */
export interface ReferencesPhoneChoice {
  screen: ReferencesPhoneScreen;
  revision: string;
}

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

/**
 * Which screen the phone shows.
 *
 * The choice is stamped with the revision it was made for rather than reset by
 * an effect, so a document that changes under an open detail — a new file, a
 * cleared one, an edit that reshapes the sheets — reads as the list on the same
 * render, with no frame of a detail for a sheet that may no longer exist.
 */
export function referencesPhoneScreen(
  choice: ReferencesPhoneChoice,
  view: ReferencesPhoneFlowView
): ReferencesPhoneScreen {
  if (!referencesPhoneHasList(view)) return 'detail';
  if (choice.revision !== view.revision) return 'list';
  return choice.screen;
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
  const phoneLayout = useIsPhoneLayout();
  const [choice, setChoice] = useState<ReferencesPhoneChoice>({
    screen: 'list',
    revision: view.revision,
  });
  const revision = view.revision;
  const { selectSheet, selectFinding } = actions;
  const showDetail = useCallback(
    (source: 'card' | 'finding') => {
      setChoice({ screen: 'detail', revision });
      track(ANALYTICS_EVENTS.referencesPatternOpened, { source });
    },
    [revision]
  );
  const openSheet = useCallback(
    (component: number) => {
      selectSheet(component);
      if (phoneLayout) showDetail('card');
    },
    [selectSheet, phoneLayout, showDetail]
  );
  const openFinding = useCallback(
    (index: number | null) => {
      selectFinding(index);
      if (phoneLayout && index !== null) showDetail('finding');
    },
    [selectFinding, phoneLayout, showDetail]
  );
  const back = useCallback(() => setChoice({ screen: 'list', revision }), [revision]);

  const screen = phoneLayout ? referencesPhoneScreen(choice, view) : null;
  return {
    screen,
    openSheet,
    openFinding,
    back: screen === 'detail' && referencesPhoneHasList(view) ? back : null,
  };
}

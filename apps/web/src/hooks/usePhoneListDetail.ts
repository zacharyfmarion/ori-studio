/**
 * A workspace on a phone: a list of the document's patterns, and a detail
 * screen for one of them.
 *
 * At 375px a desktop shape — a rail of pattern cards beside the canvas — leaves
 * the canvas a sliver, so the phone shows one of the two at a time and moves
 * between them the way the Design workspace's ExplOri panes do: a press on a
 * card opens the detail, and a Back button at the start of its toolbar returns
 * to the list. References and Simulate both have that shape, and this is the
 * state they share; each wraps it with what a press *means* there
 * (`useReferencesPhoneFlow`, `useSimulatorPhoneFlow`).
 *
 * Local state, not a store slice. The dock is cleared on every workspace switch
 * (`layoutStore.activateWorkspace`), so the panel unmounts and a return to the
 * workspace starts on the list — which is the behaviour wanted, not a loss to
 * work around. Nothing outside the panel asks which screen is showing.
 */
import { useCallback, useState } from 'react';
import { useIsPhoneLayout } from '../platform/phoneLayout';

export type PhoneScreen = 'list' | 'detail';

/** The screen last chosen, and the document it was chosen for. */
export interface PhoneScreenChoice {
  screen: PhoneScreen;
  revision: string;
}

/** What the flow reads: the document's identity, and whether it has a list. */
export interface PhoneListDetailView {
  /**
   * Whether there is a list worth showing. Without one the detail shows, with
   * no Back, and the list takes over the moment the document changes.
   */
  hasList: boolean;
  /** The document the list is of; a change of it is a return to the list. */
  revision: string;
}

/**
 * Which screen the phone shows.
 *
 * The choice is stamped with the revision it was made for rather than reset by
 * an effect, so a document that changes under an open detail — a new file, a
 * cleared one, an edit that reshapes the patterns — reads as the list on the
 * same render, with no frame of a detail for a pattern that may no longer exist.
 */
export function phoneScreen(choice: PhoneScreenChoice, view: PhoneListDetailView): PhoneScreen {
  if (!view.hasList) return 'detail';
  if (choice.revision !== view.revision) return 'list';
  return choice.screen;
}

export interface PhoneListDetail {
  /**
   * The screen a phone shows, or `null` on any other layout — which shows the
   * list and the detail side by side, as it always has. Non-null is the test
   * for "this is the phone layout", the way `useDesignPaneSwitcher`'s `panes`
   * is for Design.
   */
  screen: PhoneScreen | null;
  /**
   * Show the detail. Answers whether it did: `false` off the phone, where
   * there is nothing to open because the detail is always on screen — so a
   * wrapper can count an opening only where one happened.
   */
  openDetail: () => boolean;
  /**
   * Back to the list, or `null` where there is no list to go back to: any
   * layout but the phone's, the list itself, and a phone whose detail is
   * showing because there is no list (`hasList`).
   */
  back: (() => void) | null;
}

export function usePhoneListDetail(view: PhoneListDetailView): PhoneListDetail {
  const phoneLayout = useIsPhoneLayout();
  const [choice, setChoice] = useState<PhoneScreenChoice>({
    screen: 'list',
    revision: view.revision,
  });
  const revision = view.revision;
  const openDetail = useCallback(() => {
    if (!phoneLayout) return false;
    setChoice({ screen: 'detail', revision });
    return true;
  }, [phoneLayout, revision]);
  const back = useCallback(() => setChoice({ screen: 'list', revision }), [revision]);

  const screen = phoneLayout ? phoneScreen(choice, view) : null;
  return {
    screen,
    openDetail,
    back: screen === 'detail' && view.hasList ? back : null,
  };
}

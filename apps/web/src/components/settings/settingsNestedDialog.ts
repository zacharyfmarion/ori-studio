import { createContext, useContext } from 'react';

/**
 * Lets a tab tell the Settings modal that it has opened a dialog of its own.
 *
 * Both the modal and a nested dialog listen for Escape on `window` in the
 * capture phase, and the modal's listener is registered first — so
 * `stopPropagation` from the inner one cannot suppress it, and Escape in the
 * import review was tearing down the whole Settings modal instead of returning
 * the user to the Shortcuts list they came from. The same holds for a command
 * dialog a tab asks for (`requestChoice`): while it is open, Escape is its.
 */
export const SettingsNestedDialogContext = createContext<(open: boolean) => void>(() => {});

/** Tell the Settings modal a dialog of this tab's is open, or closed again. */
export function useSettingsNestedDialog(): (open: boolean) => void {
  return useContext(SettingsNestedDialogContext);
}

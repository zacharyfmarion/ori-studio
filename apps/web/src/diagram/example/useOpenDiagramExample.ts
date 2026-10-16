import { useCallback, useState } from 'react';
import { openDiagramExample } from './diagramExample';

/**
 * The empty Diagram's example, for its button: the open, and whether one is
 * under way — downloading, waiting on the unsaved-changes prompt, or loading —
 * so the button can say so rather than look as if the press did nothing.
 */
export function useOpenDiagramExample(): { open: () => void; opening: boolean } {
  const [opening, setOpening] = useState(false);
  const open = useCallback(() => {
    setOpening(true);
    void openDiagramExample().finally(() => setOpening(false));
  }, []);
  return { open, opening };
}

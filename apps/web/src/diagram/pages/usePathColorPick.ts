import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { trackDiagramPageSetupChanged } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DEFAULT_PATH_COLOR } from '../document/diagramDocument';
import { clearPathColorPick, livePathColor, publishPathColorPick, subscribePathColorPick } from './pathColorPick';

/**
 * How long a pick must go quiet before its colour is written to the document.
 *
 * A picker's closing is not an event to rely on — Chrome keeps the swatch
 * focused after its popup closes, and WebKit reports `change` on every move —
 * so, as a wheel's zoom on a folded figure ends when the wheel goes quiet
 * (`FOLDED_3D_ZOOM_SETTLE_MS`), a pause writes what has been picked so far.
 * Letting go of focus, or the row going away, writes it at once. A pick that
 * goes on after a pause is still the same undo step.
 */
export const PATH_COLOR_SETTLE_MS = 220;

/** Picks of the path's colour, numbered: each one undo step however often it settles. */
let picks = 0;

/** The flow path's colour being picked, or null while none is (`pathColorPick.ts`). */
export function useLivePathColor(): string | null {
  return useSyncExternalStore(subscribePathColorPick, livePathColor, livePathColor);
}

interface Pick {
  /** The undo session every write of this pick extends. */
  session: number;
  /** The diagram it was picked for: one opened meanwhile takes none of it. */
  loadId: number;
  counted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The Page pane's Path color row, bound: the colour shows as it is picked —
 * in the swatch, and in the Pages view's band, which is all that repaints —
 * and is written to the page setup as the pick settles, one undo step and one
 * count of `path_color` for the whole pick. The reset is one of each too.
 */
export function usePathColorPick() {
  const committed = useWorkspaceStore((state) => state.diagram?.page.pathColor ?? DEFAULT_PATH_COLOR);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const live = useLivePathColor();
  const pick = useRef<Pick | null>(null);

  /** Write what has been picked so far, then drop the live colour. */
  const settle = useCallback(() => {
    const current = pick.current;
    if (!current) return;
    if (current.timer !== null) clearTimeout(current.timer);
    current.timer = null;
    const color = livePathColor();
    if (color === null) return;
    const store = useWorkspaceStore.getState();
    if (
      store.diagramLoadId === current.loadId &&
      store.setDiagramPage({ pathColor: color }, { session: current.session }) &&
      !current.counted
    ) {
      current.counted = true;
      trackDiagramPageSetupChanged('path_color');
    }
    // After the store, so no frame shows the colour from before the pick.
    clearPathColorPick();
  }, []);

  const onPick = useCallback(
    (color: string) => {
      const store = useWorkspaceStore.getState();
      if (store.diagramReadOnly) return;
      pick.current ??= { session: (picks += 1), loadId: store.diagramLoadId, counted: false, timer: null };
      publishPathColorPick(color);
      if (pick.current.timer !== null) clearTimeout(pick.current.timer);
      pick.current.timer = setTimeout(settle, PATH_COLOR_SETTLE_MS);
    },
    [settle]
  );

  /** The picker let go of focus: what it picked is written now, and the next move is a new pick. */
  const onPickEnd = useCallback(() => {
    settle();
    pick.current = null;
  }, [settle]);

  // A pick still under way when the row goes — the pane closed, the path hidden — is written as it goes.
  useEffect(() => onPickEnd, [onPickEnd]);

  const onReset = useCallback(() => {
    if (useWorkspaceStore.getState().setDiagramPage({ pathColor: DEFAULT_PATH_COLOR })) {
      trackDiagramPageSetupChanged('path_color');
    }
  }, []);

  return {
    value: live ?? committed,
    readOnly,
    onPick,
    onPickEnd,
    onReset: committed !== DEFAULT_PATH_COLOR ? onReset : undefined,
  };
}

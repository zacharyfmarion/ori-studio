import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  anyGestureDraining,
  subscribeGestureDraining,
  type GestureBracket,
  type GestureToken,
} from './gestureBracket';

/** The owner name the pane opens a layer's bracket under, per field. */
export function paneGestureOwner(field: string): string {
  return `pane:${field}`;
}

/**
 * Whether the pane's rows on `bracket`'s layer should render disabled: another
 * surface holds the bracket (a canvas drag, a text session, a chip drag), or
 * any layer's commit is draining and every `begin` would be refused anyway.
 * The pane's own open gesture does not count — a slider mid-drag must not
 * disable itself.
 */
export function paneGestureHeld(bracket: GestureBracket): boolean {
  const owner = bracket.openOwner();
  return anyGestureDraining() || (owner !== null && !owner.startsWith('pane:'));
}

export interface PaneGesture {
  /** See {@link paneGestureHeld}. */
  held: boolean;
  /** Open the layer's bracket for `field`; false when refused. Re-entrant for the same field. */
  begin(field: string): boolean;
  /** Whether the pane's gesture is still the open one — an update that is not writes nothing. */
  isOpen(): boolean;
  /** Close the pane's gesture and record `label` once. A no-op with nothing open. */
  end(label: string): void;
}

/**
 * The Properties pane's side of one layer's undo bracket: the continuous
 * protocol's `begin` / `end` for every row on that layer, plus `held` for the
 * rows to disable on.
 *
 * One token for the pane rather than one per row, because one pointer drives
 * one row at a time and the bracket refuses a second owner regardless.
 * `begin` for the field that already holds the token is the bracket's
 * same-owner re-entry — the open token again, no new baseline — so a colour
 * picker that fires per move can ask on every move and a gesture aborted
 * underneath it (an undo from the menu bar) simply opens a fresh one on the
 * next move. An unmount aborts whatever is open: a pane that went away
 * mid-drag must not hold the layer against every later gesture.
 */
export function usePaneGesture(bracket: GestureBracket): PaneGesture {
  const tokenRef = useRef<GestureToken | null>(null);

  const held = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const unsubscribeOwner = bracket.subscribe(listener);
        const unsubscribeDrain = subscribeGestureDraining(listener);
        return () => {
          unsubscribeOwner();
          unsubscribeDrain();
        };
      },
      [bracket]
    ),
    useCallback(() => paneGestureHeld(bracket), [bracket])
  );

  useEffect(
    () => () => {
      const token = tokenRef.current;
      tokenRef.current = null;
      if (token) bracket.abort(token);
    },
    [bracket]
  );

  const begin = useCallback(
    (field: string) => {
      const token = bracket.begin(paneGestureOwner(field));
      // A refusal for one field must not drop the token another field of this
      // pane still holds — a second finger on a second slider is refused, and
      // the first slider's drag still has to end.
      if (token) tokenRef.current = token;
      return token !== null;
    },
    [bracket]
  );
  const isOpen = useCallback(
    () => tokenRef.current !== null && bracket.isOpen(tokenRef.current),
    [bracket]
  );
  const end = useCallback(
    (label: string) => {
      const token = tokenRef.current;
      tokenRef.current = null;
      if (token) void bracket.commit(token, label);
    },
    [bracket]
  );

  return useMemo(() => ({ held, begin, isOpen, end }), [held, begin, isOpen, end]);
}

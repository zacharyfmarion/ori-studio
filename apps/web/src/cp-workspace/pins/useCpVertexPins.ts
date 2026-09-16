/**
 * The store bindings a pinned vertex needs, in one place.
 *
 * A hook beside the concern rather than three `useWorkspaceStore` calls in the
 * panel: the panel chooses that pinning is mounted, not what pinning does. The
 * shape is {@link import('../hooks/useViewportSurface')}'s — state and the verbs
 * that change it, nothing derived that a caller could compute itself.
 *
 * The pure half is {@link import('./vertexPins')}, which is where the rules live
 * and where they are tested.
 */
import { useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ModelPoint } from '../renderer/types';
import type { CpVertexPin } from './vertexPins';

export interface UseCpVertexPins {
  /** Every pin on the open document, in placement order. */
  pins: readonly CpVertexPin[];
  /** Pin the vertex at `point`, or unpin the one already there. */
  toggle: (point: ModelPoint) => void;
  /**
   * Drop every pin inside `box` — what accepting or deleting a solve region
   * does. Scoped, so pins outside it survive.
   */
  clearIn: (box: { contains: (point: ModelPoint) => boolean }) => void;
}

export function useCpVertexPins(): UseCpVertexPins {
  const pins = useWorkspaceStore((state) => state.oristudioCpPinnedVertices);
  const togglePin = useWorkspaceStore((state) => state.toggleOristudioCpVertexPin);
  const clearPinsIn = useWorkspaceStore((state) => state.clearOristudioCpVertexPinsIn);

  const toggle = useCallback((point: ModelPoint) => togglePin(point), [togglePin]);
  const clearIn = useCallback(
    (box: { contains: (point: ModelPoint) => boolean }) => clearPinsIn(box),
    [clearPinsIn]
  );

  return useMemo(() => ({ pins, toggle, clearIn }), [clearIn, pins, toggle]);
}

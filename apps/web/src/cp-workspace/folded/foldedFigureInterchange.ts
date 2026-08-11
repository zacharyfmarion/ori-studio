/**
 * Which folded figures a `.fold` export can carry, and which it cannot.
 *
 * A `foldedForm` frame is built in the kernel from the live `Fold3dSession` —
 * the placement rings, the plane frames and the layer relation, none of which
 * is persisted. So the frame can only be written for a figure that still holds
 * a kernel handle: one folded in this session, or one whose handle history
 * still reaches it.
 *
 * A figure reopened from an `.osf` has `handle: null` by construction. It draws,
 * because its projected primitives were persisted, but it is not a session — the
 * same reason it cannot cycle. Rather than let that vanish quietly from an
 * export, `detachedFolded3dFigures` counts them so
 * `lib/supersetFeatures.ts` can say so, and Refold is the escape hatch.
 *
 * Pure, React-free and store-free.
 */

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { isFolded3dFigure } from './foldedFigureCapabilities';

/**
 * Kernel handles of the 3D figures a `.fold` export should write frames for, in
 * canvas order — which is the order the frames appear in the file.
 */
export function folded3dExportHandles(
  figures: readonly OristudioCpFoldedFigureEntry[]
): number[] {
  const handles: number[] = [];
  for (const figure of figures) {
    if (!isFolded3dFigure(figure)) continue;
    if (figure.handle == null) continue;
    handles.push(figure.handle);
  }
  return handles;
}

/**
 * 3D figures that draw but cannot be written to a `.fold`, because the session
 * that could describe them is gone.
 */
export function detachedFolded3dFigures(
  figures: readonly OristudioCpFoldedFigureEntry[]
): OristudioCpFoldedFigureEntry[] {
  return figures.filter((figure) => isFolded3dFigure(figure) && figure.handle == null);
}

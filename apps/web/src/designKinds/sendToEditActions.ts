import type { TFunction } from 'i18next';
import type { DesignKindId } from './types';

/**
 * The Send to Edit verbs a design kind offers, as plain data.
 *
 * The toolbar renders these; it does not decide them. Whether a kind has a
 * with-circles variant is a fact about the kind, not about the button — and
 * keeping it here means the answer is testable without mounting anything, and
 * a fourth kind brings its own answer rather than editing a switch in the
 * chrome.
 *
 * React-free and store-free by design, like `foldedFigureActions`: it takes the
 * kind plus what the caller already knows, and returns descriptors.
 */

/** Which kinds have a packing whose circles can be carried into Edit. */
const KINDS_WITH_PACKING_CIRCLES: readonly DesignKindId[] = ['treemaker', 'box-pleat'];

/**
 * Whether this kind can send circles at all.
 *
 * ExplOri cannot: a result is a lookup into a tiling archive, carrying a `cp`
 * and a `packing` that are both plain vertex/edge lists. There is no radius
 * anywhere, and no scale to derive one from, because the tiling is not a packing
 * of the user's tree.
 */
export function kindHasPackingCircles(kind: DesignKindId): boolean {
  return KINDS_WITH_PACKING_CIRCLES.includes(kind);
}

export interface SendToEditVariant {
  /** Stable id — also the analytics value, so an enum and never free text. */
  id: 'plain' | 'with-circles';
  label: string;
  title: string;
  includeCircles: boolean;
}

/**
 * The primary Send to Edit action for a kind. Always present.
 *
 * Literal `t()` calls so `i18n:extract` sees the strings (see apps/web/CLAUDE.md).
 */
export function sendToEditPrimary(t: TFunction): SendToEditVariant {
  return {
    id: 'plain',
    label: t('common:toolbar.sendToEdit', 'Send to Edit'),
    title: t('common:toolbar.sendToEditTooltip', "Send this design's crease pattern to the Edit canvas"),
    includeCircles: false,
  };
}

/**
 * The extra actions behind the caret — empty for a kind with no packing, which
 * is what makes `SplitButton` fall back to a plain button there.
 */
export function sendToEditVariants(kind: DesignKindId, t: TFunction): SendToEditVariant[] {
  if (!kindHasPackingCircles(kind)) return [];
  return [
    {
      id: 'with-circles',
      label: t('common:toolbar.sendToEditWithCircles', 'Send to Edit (include circles)'),
      title: t(
        'common:toolbar.sendToEditWithCirclesTooltip',
        "Send this design's crease pattern along with its packed circles"
      ),
      includeCircles: true,
    },
  ];
}

/** Accessible name for the caret itself. */
export function sendToEditMenuLabel(t: TFunction): string {
  return t('common:toolbar.sendToEditMore', 'More Send to Edit options');
}

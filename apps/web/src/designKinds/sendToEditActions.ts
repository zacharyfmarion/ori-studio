import type { TFunction } from 'i18next';
import type { SplitButtonAction } from '../components/ui/SplitButton';
import type { DesignKindId } from './types';

/**
 * The Send to Edit verbs a source offers, as plain data.
 *
 * The toolbar renders these; it does not decide them. Whether a kind has a
 * with-circles variant is a fact about the kind, not about the button — and
 * keeping it here means the answer is testable without mounting anything, and
 * a fourth kind brings its own answer rather than editing a switch in the
 * chrome.
 *
 * React-free and store-free by design, like `foldedFigureActions`: it takes the
 * source plus what the caller already knows, and returns descriptors.
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

/** The variants behind the caret, by id. The primary is always `'plain'`. */
export type SendToEditExtraVariantId = 'with-circles';

export interface SendToEditVariant {
  /** Stable id — also the analytics value, so an enum and never free text. */
  id: 'plain' | SendToEditExtraVariantId;
  label: string;
  title: string;
  includeCircles: boolean;
}

/**
 * A source of Send to Edit that is not a design: a surface with a crease
 * pattern of its own, such as a Fold sequence.
 *
 * It offers the same verb, label and button. The two things a design kind's
 * identity settles — what is being sent, and which variants make sense — a
 * surface states for itself.
 */
export interface SendToEditSurfaceSource {
  /**
   * The primary's tooltip, already translated: what this surface sends. Its
   * own, because the design kinds' sentence says "this design's".
   */
  title: string;
  /**
   * The variants behind the caret. None, or absent, keeps a plain button. Each
   * is worded once here for every source, and `'with-circles'` speaks of a
   * design's packing.
   */
  variants?: readonly SendToEditExtraVariantId[];
}

/**
 * Where a Send to Edit starts: a design kind, whose variants follow from what
 * the kind is, or a surface that names its own.
 */
export type SendToEditSource = DesignKindId | SendToEditSurfaceSource;

/**
 * The primary Send to Edit action for a source. Always present.
 *
 * Every design kind's is the same, so `source` matters only for a surface, and
 * a caller with a kind in hand may leave it out.
 *
 * Literal `t()` calls so `i18n:extract` sees the strings (see apps/web/CLAUDE.md).
 */
export function sendToEditPrimary(t: TFunction, source?: SendToEditSource): SendToEditVariant {
  return {
    id: 'plain',
    label: t('common:toolbar.sendToEdit', 'Send to Edit'),
    title:
      typeof source === 'object'
        ? source.title
        : t('common:toolbar.sendToEditTooltip', "Send this design's crease pattern to the Edit canvas"),
    includeCircles: false,
  };
}

/**
 * Each variant behind the caret, labelled once for every source that offers
 * it. A `Record`, so a new id cannot be offered before it has its strings.
 */
const EXTRA_VARIANTS: Record<SendToEditExtraVariantId, (t: TFunction) => SendToEditVariant> = {
  'with-circles': (t) => ({
    id: 'with-circles',
    label: t('common:toolbar.sendToEditWithCircles', 'Send to Edit (include circles)'),
    title: t(
      'common:toolbar.sendToEditWithCirclesTooltip',
      "Send this design's crease pattern along with its packed circles"
    ),
    includeCircles: true,
  }),
};

/**
 * The extra actions behind the caret — empty for a kind with no packing, or a
 * surface that names none, which is what makes `SplitButton` fall back to a
 * plain button there.
 */
export function sendToEditVariants(source: SendToEditSource, t: TFunction): SendToEditVariant[] {
  const ids: readonly SendToEditExtraVariantId[] =
    typeof source === 'string'
      ? kindHasPackingCircles(source)
        ? ['with-circles']
        : []
      : (source.variants ?? []);
  return ids.map((id) => EXTRA_VARIANTS[id](t));
}

/** Accessible name for the caret itself. */
export function sendToEditMenuLabel(t: TFunction): string {
  return t('common:toolbar.sendToEditMore', 'More Send to Edit options');
}

/**
 * Everything the Send to Edit `SplitButton` takes apart from its chrome. The
 * icon is lucide's `Send` wherever the verb appears; size and rank (primary or
 * secondary beside the toolbar's other actions) belong to the surface placing it.
 */
export interface SendToEditButtonModel {
  label: string;
  title: string;
  disabled: boolean;
  menuLabel: string;
  actions: SplitButtonAction[];
  run: () => void;
}

/** What a source's caller knows that this module cannot: the call, and whether it can run now. */
export interface SendToEditBinding {
  /** Sends with the options of `variant` — the primary or one behind the caret. */
  send: (variant: SendToEditVariant) => void;
  disabled: boolean;
  /** Why it cannot run, shown in place of the primary's tooltip while disabled. */
  reason?: string;
}

/**
 * The Send to Edit button for one source, as one model over every source, so
 * a surface that is not a design gets the same button a design kind does by
 * supplying only its {@link SendToEditBinding}.
 */
export function sendToEditButtonModel(
  source: SendToEditSource,
  t: TFunction,
  binding: SendToEditBinding
): SendToEditButtonModel {
  const primary = sendToEditPrimary(t, source);
  return {
    label: primary.label,
    title: binding.disabled && binding.reason ? binding.reason : primary.title,
    disabled: binding.disabled,
    menuLabel: sendToEditMenuLabel(t),
    run: () => binding.send(primary),
    actions: sendToEditVariants(source, t).map((variant) => ({
      id: variant.id,
      label: variant.label,
      title: variant.title,
      onSelect: () => binding.send(variant),
    })),
  };
}

/**
 * What a placed 3D figure has to say about itself, if anything.
 *
 * The kernel's verdict is three-way and only one of the three is silent. A
 * refusal is a different type entirely — it means *no figure*, and it is
 * answered at the fold, not on the canvas (see `fold3dRefusalMessage`); this
 * module speaks only for a figure that **exists and draws**.
 *
 * None of these is an error and none destroys the figure — the principle the
 * flat path already states for a layer-ordering contradiction. They ride on the
 * entry, so deleting or refolding the figure clears them for free.
 *
 * React-free and store-free: it takes an entry and a `t`, and returns a plain
 * descriptor that the toolbar renders as a chip, the context menu as a disabled
 * header, and the folded-models dropdown as a subtitle. One definition, three
 * surfaces, no drift.
 */

import type { TFunction } from 'i18next';
import type {
  OristudioCpFlatFoldabilityRuleCode,
  OristudioCpFold3dCrossing,
  OristudioCpFold3dOrderReason,
  OristudioCpFold3dRefusal,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { documentLineIdsForKernelLines, kernelLineOrder } from './foldRoute';
import { foldedFigureCurrentCase } from './foldedFigureState';

/** What a notice asks the user to do about it. */
export type FoldedFigureNoticeActionId = 'show-issues' | 'select-creases' | 'simulate-instead';

export interface FoldedFigureNoticeAction {
  id: FoldedFigureNoticeActionId;
  label: string;
  /**
   * Document line ids the action should select. Empty for actions that select
   * nothing — `show-issues` turns on the CAMV overlay, which names its own
   * vertices.
   */
  lineIds: number[];
}

export interface FoldedFigureNotice {
  id: 'local-crossing' | 'transversal-crossing' | 'no-layer-order';
  tone: 'warn' | 'error';
  /** Short, for the toolbar chip and the dropdown subtitle. */
  label: string;
  /** One sentence, for a tooltip and the context-menu header. */
  detail: string;
  action: FoldedFigureNoticeAction | null;
}

/**
 * The creases a crossing names, as document line ids.
 *
 * Every crossing arm carries kernel slice indices, which are positions in the
 * ascending, deduped, foldable-colour-filtered selection — never document ids.
 * Derived at read time from the entry's own `sourceLineIds` rather than stored a
 * second time.
 */
export function crossingLineIds(
  figure: Pick<OristudioCpFoldedFigureEntry, 'sourceLineIds'>,
  crossings: readonly OristudioCpFold3dCrossing[]
): number[] {
  const order = kernelLineOrder(figure.sourceLineIds ?? []);
  const indices: number[] = [];
  for (const crossing of crossings) {
    switch (crossing.code) {
      case 'chords':
        indices.push(crossing.lines[0], crossing.lines[1]);
        break;
      case 'transversal':
      case 'sheets':
        indices.push(crossing.line);
        break;
    }
  }
  return documentLineIdsForKernelLines(order, indices);
}

/**
 * The creases a contradictory-seed reason names.
 *
 * The only order reason that names creases at all, and it is the one the kernel
 * bothered to name them for: "two faces each have to be above the other" is not
 * actionable without knowing which creases said so.
 */
export function orderReasonLineIds(
  figure: Pick<OristudioCpFoldedFigureEntry, 'sourceLineIds'>,
  reason: OristudioCpFold3dOrderReason
): number[] {
  if (reason.code !== 'contradictory_seeds') return [];
  const order = kernelLineOrder(figure.sourceLineIds ?? []);
  return documentLineIdsForKernelLines(order, [reason.first_line, reason.second_line]);
}

/** Why a placed figure has no stacking, in one sentence. */
export function orderReasonDetail(t: TFunction, reason: OristudioCpFold3dOrderReason): string {
  // Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
  switch (reason.code) {
    case 'contradictory_seeds':
      return t(
        'panels:fold3dVerdict.noLayerOrderContradictorySeeds',
        'Two faces each have to be above the other, so no stacking can satisfy both.'
      );
    case 'stack_too_deep':
      return t(
        'panels:fold3dVerdict.noLayerOrderStackTooDeep',
        'Too many layers meet here to search every stacking.'
      );
    case 'overlap_without_cell':
    case 'cell_without_overlap':
    case 'arrangement_refused':
    case 'no_layer_order':
    case 'face_id_out_of_range':
    case 'search_failed':
      return t(
        'panels:fold3dVerdict.noLayerOrderGeneric',
        'The layers of this figure could not be put in order.'
      );
  }
}

/**
 * The notice for `figure`, or `null` when there is nothing to say.
 *
 * `null` on every flat figure and on a 3D figure whose verdict is `folded` —
 * silence is the right report for success, and a chip that always shows is a
 * chip nobody reads.
 */
export function foldedFigureNotice(
  t: TFunction,
  figure: OristudioCpFoldedFigureEntry | null | undefined
): FoldedFigureNotice | null {
  const snapshot = figure?.folded3d ?? null;
  if (!figure || !snapshot) return null;
  const verdict = snapshot.verdict;
  switch (verdict.verdict) {
    case 'folded':
      return null;
    case 'local_crossing':
      return {
        id: 'local-crossing',
        tone: 'warn',
        label: t('panels:fold3dVerdict.localCrossingLabel', 'Passes through itself'),
        detail: t('panels:fold3dVerdict.localCrossing', {
          defaultValue_one: 'The paper passes through itself at one vertex.',
          defaultValue_other: 'The paper passes through itself at {{count}} vertices.',
          count: verdict.vertices,
        }),
        action: {
          id: 'show-issues',
          label: t('panels:fold3dVerdict.showIssues', 'Show issues'),
          lineIds: [],
        },
      };
    case 'transversal_crossing': {
      const lineIds = crossingLineIds(figure, snapshot.crossings);
      return {
        id: 'transversal-crossing',
        tone: 'warn',
        label: t('panels:fold3dVerdict.transversalCrossingLabel', 'Crease cuts a face'),
        detail: t('panels:fold3dVerdict.transversalCrossing', {
          defaultValue_one: 'One folded crease passes through a face of the figure.',
          defaultValue_other: '{{count}} folded creases pass through faces of the figure.',
          count: verdict.crossings,
        }),
        // Nothing to select is not an action: the kernel lists at most 16
        // crossings and can report a count with none of them resolvable.
        action:
          lineIds.length > 0
            ? {
                id: 'select-creases',
                label: t('panels:fold3dVerdict.selectCreases', 'Select the creases'),
                lineIds,
              }
            : null,
      };
    }
    case 'no_layer_order':
      return {
        id: 'no-layer-order',
        tone: 'error',
        label: t('panels:fold3dVerdict.noLayerOrderLabel', 'Layers not ordered'),
        detail: orderReasonDetail(t, verdict.reason),
        action: {
          id: 'simulate-instead',
          label: t('panels:fold3dVerdict.simulateInstead', 'Simulate instead'),
          lineIds: orderReasonLineIds(figure, verdict.reason),
        },
      };
  }
}

/**
 * What the folded-models list says under a figure's title.
 *
 * Stale first (it is the one the user can act on), then a verdict if there is
 * one, then the solution the figure is showing. The non-`ready` arms used to
 * render `figure.status` — a raw identifier, untranslated, reading `loading` or
 * `error` in eight locales.
 */
export function foldedFigureSubtitle(
  t: TFunction,
  figure: OristudioCpFoldedFigureEntry,
  stale: boolean
): string {
  if (stale) return t('panels:creasePattern.stale', 'Stale');
  // Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
  switch (figure.status) {
    case 'loading':
      return t('panels:creasePattern.foldedModelStatus.loading', 'Folding…');
    case 'error':
      return t('panels:creasePattern.foldedModelStatus.error', 'Failed');
    case 'stale':
      return t('panels:creasePattern.stale', 'Stale');
    case 'ready': {
      const notice = foldedFigureNotice(t, figure);
      if (notice) return notice.label;
      return t('panels:creasePattern.case', 'Case {{count}}', {
        count: foldedFigureCurrentCase(figure),
      });
    }
  }
}

/**
 * Why a crease pattern has no 3D folded figure at all, as one sentence.
 *
 * Budgeted by measured frequency rather than by novelty. Over the 65 measurable
 * files of the external non-flat corpus the whole distribution is 21
 * `flat_foldability`, 8 `vertex_closure`, 7 `interior_cut` and 1 `disconnected`
 * — those are file counts, not model counts, since ten basenames appear twice,
 * so it is a ranking and not a rate. The other six arms are reachable in
 * principle and reached by nothing, and they get one plain line each.
 *
 * The three most common arms cost **no new translation**: their sentences
 * already exist, worded and translated in all eight locales, for the flat
 * foldability panel and the disconnected-fold error.
 */
export function fold3dRefusalMessage(t: TFunction, refusal: OristudioCpFold3dRefusal): string {
  // Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
  switch (refusal.code) {
    case 'flat_foldability':
      return flatFoldabilityRuleMessage(t, refusal.rule);
    case 'vertex_closure':
      return t(
        'dialogs:fold3dRefused.vertexClosure',
        'The creases at one vertex do not close up: they are {{degrees}}° short of meeting.',
        { degrees: formatDegrees(refusal.residual_degrees) }
      );
    case 'interior_cut':
      return t(
        'panels:creasePattern.foldability.interiorBorder',
        'Edge with paper on both sides — foldability is not checked along it'
      );
    case 'disconnected':
      return t(
        'errors:fold.disconnected',
        "This selection falls into separate pieces that don't touch, so it can't be folded as one model. Select one piece and fold again."
      );
    case 'no_faces':
      return t(
        'dialogs:fold3dRefused.noFaces',
        'These creases enclose no piece of paper to fold.'
      );
    case 'faces_unresolved':
      return t(
        'dialogs:fold3dRefused.facesUnresolved',
        'The faces of this crease pattern could not be worked out. Creases that cross without a vertex, or stop short of one, are the usual cause.'
      );
    case 'non_crease_join':
      return t(
        'dialogs:fold3dRefused.nonCreaseJoin',
        'Two faces meet along an edge that is not a crease.'
      );
    case 'vertex_indeterminate':
      return refusal.cause === 'unassigned_crease'
        ? t(
            'dialogs:fold3dRefused.vertexUnassignedCrease',
            'A crease at one vertex has no fold assigned, so the vertex cannot be folded.'
          )
        : t(
            'dialogs:fold3dRefused.vertexUnsplitJunction',
            'Creases meet at a point that is not a vertex, so the vertex cannot be folded.'
          );
    case 'loop_not_closed':
      return t(
        'dialogs:fold3dRefused.loopNotClosed',
        'Folding around a loop of faces does not return to where it started, so these angles cannot all hold at once.'
      );
    case 'tolerance_window_closed':
      return t(
        'dialogs:fold3dRefused.toleranceWindowClosed',
        'Two faces are too close to the same plane to tell apart.'
      );
  }
}

/**
 * The flat-foldability rule a refusal names, worded as the foldability panel
 * already words it.
 *
 * Maps the kernel's snake_case refusal codes onto the phrases
 * `foldabilityMessages.ts` publishes for Oriedita's rule enum. Deliberately not
 * a second table: the same theorem failing must not read two ways depending on
 * which check found it.
 */
export function flatFoldabilityRuleMessage(
  t: TFunction,
  rule: OristudioCpFlatFoldabilityRuleCode
): string {
  // Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
  switch (rule) {
    case 'number_of_folds':
      return t('panels:creasePattern.foldability.oddFolds', 'Odd number of folds');
    case 'angles':
      return t('panels:creasePattern.foldability.incorrectAngles', 'Incorrect angles');
    case 'maekawa':
      return t('panels:creasePattern.foldability.incorrectFoldTypes', 'Incorrect fold types');
    case 'little_big_little':
      return t(
        'panels:creasePattern.foldability.littleBigLittle',
        'Angles cannot nest (little-big-little)'
      );
    case 'none':
      return t(
        'dialogs:fold3dRefused.flatFoldabilityGeneric',
        'One vertex of this crease pattern cannot fold.'
      );
  }
}

/** Degrees, trimmed — a residual is a magnitude, not a measurement to publish. */
function formatDegrees(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

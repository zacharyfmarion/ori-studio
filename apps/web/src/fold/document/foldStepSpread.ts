/**
 * The layer spread a Fold step's folded picture shows (Wave 5): the Diagram's
 * start rule, read along the step's path rather than down a page. The default
 * is no spread — the paper lying flat, unlike a Diagram step's flat fold,
 * which starts spread — and a step can toggle and adjust its own, which the
 * steps after it take. (Wave 5 first started every picture spread, as the
 * Diagram does; the default became off on 2026-10-18.)
 *
 * - **Its own setting**, when it has one (`FoldStep.spread`): a spread, or off.
 * - **Else the nearest earlier step's** on its path — the steps it folds
 *   from — so a spread set on step 2 reaches steps 3, 4 … until one of them
 *   says otherwise, and off is a setting that reaches them too.
 * - **Else off**, so Fold starts with the paper lying flat.
 *
 * A newer build's spread, carried, is no setting this build can show: the
 * step takes an earlier one's. The flat sheet has no setting and takes the
 * default, which moves nothing on paper with one layer.
 *
 * This is the one function the folded pane, the step strip's pictures and the
 * Diagram's import read a step's spread through.
 *
 * Pure: no React, no store, no engine.
 */
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  sameSpread,
  spreadStartsAmong,
  type LayerSpreadStarts,
} from '../../cp-workspace/folded/layerSpreadSettings';
import {
  isKnownSpread,
  isLockedStep,
  type FoldSequenceDocument,
  type FoldSpreadSetting,
  type FoldStepNode,
} from './foldSequenceDocument';
import { foldStepTree } from './foldStepTree';

/** Where the spread a step shows comes from: its own setting, an earlier step's, or the default. */
export type FoldSpreadOrigin = 'own' | 'earlier' | 'default';

/** A step's spread as its picture shows it: null for none, and where that comes from. */
export interface FoldEffectiveSpread {
  spread: LayerSpreadOptions | null;
  origin: FoldSpreadOrigin;
  /** The step whose setting it is, for `own` and `earlier`; null for the default. */
  from: string | null;
}

const DEFAULT: FoldEffectiveSpread = { spread: null, origin: 'default', from: null };

/**
 * A node's own setting, when it has one this build reads. A locked node has
 * none: it and everything below it show no picture, so none takes its look.
 */
function ownSetting(node: FoldStepNode): FoldSpreadSetting | undefined {
  if (isLockedStep(node) || node.spread === undefined) return undefined;
  return isKnownSpread(node.spread) ? node.spread : undefined;
}

/**
 * The nodes from `stepId` back to the first step, the step itself first;
 * empty for the sheet or a step that is not there. Bounded by the node count,
 * so a damaged tree cannot loop.
 */
function* backFrom(document: FoldSequenceDocument, stepId: string | null): Generator<FoldStepNode> {
  if (stepId === null) return;
  const { byId } = foldStepTree(document.steps);
  let node = byId.get(stepId);
  for (let guard = byId.size; node && guard > 0; guard -= 1) {
    yield node;
    node = node.parent === null ? undefined : byId.get(node.parent);
  }
}

/**
 * The spread step `stepId` shows, and where it comes from: its own setting,
 * else the nearest earlier step's on its path, else the default. The sheet
 * (`null`) and a step not in the sequence show the default.
 */
export function foldEffectiveSpread(document: FoldSequenceDocument, stepId: string | null): FoldEffectiveSpread {
  for (const node of backFrom(document, stepId)) {
    const own = ownSetting(node);
    if (own === undefined) continue;
    return { spread: own === 'off' ? null : own, origin: node.id === stepId ? 'own' : 'earlier', from: node.id };
  }
  return DEFAULT;
}

/**
 * The spread step `stepId`'s folded picture shows — null for none: what the
 * folded pane, a step's card and a Diagram step pulled from it are drawn
 * with. The sheet (`null`) shows the default.
 */
export function foldStepSpread(document: FoldSequenceDocument, stepId: string | null): LayerSpreadOptions | null {
  return foldEffectiveSpread(document, stepId).spread;
}

/** What step `stepId` would show with no setting of its own: the steps before it decide. */
export function foldInheritedSpread(document: FoldSequenceDocument, stepId: string): LayerSpreadOptions | null {
  const node = foldStepTree(document.steps).byId.get(stepId);
  return foldStepSpread(document, node?.parent ?? null);
}

/**
 * The spread of the state a Diagram picture of a step shows (plan D17): the
 * one the step folds from (`before`) is its parent's picture, so it shows its
 * parent's spread — the sheet's default for a first step — and the one it
 * lands (`after`) shows the step's own. A state looks the same in both.
 */
export function foldStateSpread(
  document: FoldSequenceDocument,
  stepId: string,
  moment: 'before' | 'after'
): LayerSpreadOptions | null {
  return moment === 'after' ? foldStepSpread(document, stepId) : foldInheritedSpread(document, stepId);
}

/**
 * What a step's spread starts from when it is turned on, or switched to a
 * kind: the shared start rule (`spreadStartsAmong`) over the spreads the
 * steps before it show, nearest first — so turning one on takes the look of
 * the steps around it — else the defaults.
 */
export function foldSpreadStarts(document: FoldSequenceDocument, stepId: string): LayerSpreadStarts {
  const parent = foldStepTree(document.steps).byId.get(stepId)?.parent ?? null;
  function* earlier(): Generator<LayerSpreadOptions> {
    for (const node of backFrom(document, parent)) {
      const own = ownSetting(node);
      if (own !== undefined && own !== 'off') yield own;
    }
  }
  return spreadStartsAmong(earlier());
}

/** Whether a setting is what the steps before would give anyway: the same spread, or off and off. */
export function sameAsInherited(setting: FoldSpreadSetting, inherited: LayerSpreadOptions | null): boolean {
  return setting === 'off' ? inherited === null : sameSpread(setting, inherited);
}

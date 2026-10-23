/**
 * How deeply Fold stacks layers, and how it says a crease pattern, a step or
 * a fold stacks them deeper.
 *
 * Working out a layer order costs the engine about as much as there are
 * triples of faces overlapping one another — a stack `d` layers deep has
 * `d(d-1)(d-2)/6` of them — however few faces the state has: a fully stacked
 * 400-face map fold took seconds to import, and 1,600 faces did not finish.
 * The engine refuses a state with more of them than
 * `oristudio_layer_order::MAX_STACKED_TRIPLES` wherever one is built — an
 * import (`import_stacked_too_deep`), a fold or a stored step's replay
 * (`stacked_too_deep`) — as soon as its overlaps are known, before any order
 * is looked for. The count is the state's own, not a clock's, so a saved
 * step is refused, or not, alike on every machine.
 *
 * Unlike the face count, nothing outside the engine knows it before asking:
 * the refusal carries it, with the deepest stack, which is what the words
 * name.
 *
 * Pure: no DOM, no store. Literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { FoldFaceCapSubject } from './foldFaceCap';

/** A refusal's stacking: the deepest stack, the triples of overlapping faces, and the cap on them. */
export interface FoldStackDepth {
  readonly deepest: number;
  readonly triples: number;
  readonly limit: number;
}

/** The engine's refusals of a stack too deep: a state's, and an import's. */
export const FOLD_STACK_CAP_CODES: readonly string[] = ['stacked_too_deep', 'import_stacked_too_deep'];

/**
 * The counts a refusal of the stacking cap carries (its `deepest`, `triples`
 * and `limit`); null for any other refusal, or one without them.
 */
export function foldStackDepthOf(refusal: { readonly code: string }): FoldStackDepth | null {
  if (!FOLD_STACK_CAP_CODES.includes(refusal.code)) return null;
  const { deepest, triples, limit } = refusal as Readonly<Record<string, unknown>>;
  if (typeof deepest !== 'number' || typeof triples !== 'number' || typeof limit !== 'number') return null;
  return { deepest, triples, limit };
}

/** A refusal of the stacking cap as a notice says it: the deepest stack, in plain words. */
export function foldStackCapWords(
  t: TFunction,
  { deepest }: FoldStackDepth,
  subject: FoldFaceCapSubject
): { title: string; text: string } {
  const title = t('tools:fold.refusal.stackedTooDeep.title', 'Layers stacked too deep');
  switch (subject) {
    case 'pattern':
      return {
        title,
        text: t(
          'tools:fold.refusal.stackedTooDeep.pattern',
          'This crease pattern stacks its layers too deeply for Fold to work out their order, up to {{deepest, number}} on top of each other. Import a simpler pattern.',
          { deepest }
        ),
      };
    case 'step':
      return {
        title,
        text: t(
          'tools:fold.refusal.stackedTooDeep.step',
          'This step stacks its layers too deeply for Fold to work out their order, up to {{deepest, number}} on top of each other. It and the steps after it can only be deleted.',
          { deepest }
        ),
      };
    case 'fold':
      return {
        title,
        text: t(
          'tools:fold.refusal.stackedTooDeep.fold',
          'This fold would stack the layers too deeply for Fold to work out their order, up to {{deepest, number}} on top of each other. Fold fewer layers.',
          { deepest }
        ),
      };
  }
}

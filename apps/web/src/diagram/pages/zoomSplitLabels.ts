/**
 * What the Pages view and the export dialog say when an enlarged step prints
 * on the page after the area it enlarges (Revision 2, Z3): one sentence, its
 * step numbers listed as every Diagram notice lists them
 * (`formatStepNumbers`), so the two never say it differently, and the verb
 * that keeps the two together, on the steps it is for. About one step, or
 * several, by how many — not by the plural form of the count, which in
 * Russian is "one" for 21 too.
 *
 * Literal `t()` calls, so the extractor sees each key.
 */
import type { TFunction } from 'i18next';
import { formatStepNumbers } from '../stepNumberList';
import type { ZoomSplit } from './zoomArrows';

/** The sentence for `splits`, in `language`; null when there are none. */
export function zoomSplitSentence(splits: readonly ZoomSplit[], t: TFunction, language: string): string | null {
  const [first] = splits;
  if (!first) return null;
  if (splits.length === 1) {
    return t(
      'panels:diagram.pages.zoomSplitStep',
      'Step {{step}} is on the page after the area it enlarges, on step {{area}}. Start a New Page Here on step {{area}} keeps them together.',
      { step: first.step, area: first.area }
    );
  }
  return t(
    'panels:diagram.pages.zoomSplitSteps',
    'Steps {{steps}} are each on the page after the area they enlarge. Start a New Page Here on steps {{areas}} keeps them together.',
    {
      steps: formatStepNumbers(splits.map(({ step }) => step), language, t),
      areas: formatStepNumbers(splits.map(({ area }) => area), language, t),
    }
  );
}

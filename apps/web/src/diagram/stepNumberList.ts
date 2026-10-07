/**
 * Step numbers listed in a sentence, the same way wherever the Diagram says
 * which steps something is about: the export dialog's notices and the Pages
 * view's. Literal `t()` calls, so the extractor sees each key.
 */
import type { TFunction } from 'i18next';

/** At most this many step numbers are named in a sentence; the rest are counted. */
export const NAMED_STEPS = 8;

/** "4, 5 and 9", or "4, 5, 6, … and 12 more": the steps a Notice sentence is about. */
export function formatStepNumbers(numbers: readonly number[], language: string, t: TFunction): string {
  const named = numbers.slice(0, NAMED_STEPS).map(String);
  const more = numbers.length - named.length;
  if (more > 0) {
    named.push(t('dialogs:diagramExport.moreSteps', '{{count}} more', { count: more, defaultValue_one: '{{count}} more' }));
  }
  return new Intl.ListFormat(language, { type: 'conjunction' }).format(named);
}

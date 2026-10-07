import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { formatStepNumbers, NAMED_STEPS } from '../stepNumberList';
import { zoomSplitSentence } from './zoomSplitLabels';

/** The English defaults, interpolated: what an untranslated build shows. */
const t = ((_key: string, fallback: string, values: Record<string, unknown> = {}) =>
  fallback.replace(/{{(\w+)}}/g, (_, name: string) => String(values[name]))) as unknown as TFunction;

describe('zoomSplitSentence (Revision 2)', () => {
  it('names the one enlarged step and the step its area is on', () => {
    expect(zoomSplitSentence([{ step: 10, area: 9 }], t, 'en')).toBe(
      'Step 10 is on the page after the area it enlarges, on step 9. Start a New Page Here on step 9 keeps them together.'
    );
    expect(zoomSplitSentence([], t, 'en')).toBeNull();
  });

  it('names several enlarged steps and their areas’ steps, listed as every Diagram notice lists steps', () => {
    expect(
      zoomSplitSentence(
        [
          { step: 10, area: 9 },
          { step: 19, area: 18 },
        ],
        t,
        'en'
      )
    ).toBe('Steps 10 and 19 are each on the page after the area they enlarge. Start a New Page Here on steps 9 and 18 keeps them together.');
    // More than are named: the rest counted, the same way in the Pages view and the export dialog.
    const splits = Array.from({ length: NAMED_STEPS + 2 }, (_, index) => ({ step: 10 * (index + 1) + 1, area: 10 * (index + 1) }));
    const sentence = zoomSplitSentence(splits, t, 'en')!;
    expect(sentence).toContain(`Steps ${formatStepNumbers(splits.map(({ step }) => step), 'en', t)} are`);
    expect(sentence).toContain(`on steps ${formatStepNumbers(splits.map(({ area }) => area), 'en', t)} keeps`);
    expect(sentence).toContain('71, 81, and 2 more are');
    expect(sentence).not.toContain('91');
  });
});

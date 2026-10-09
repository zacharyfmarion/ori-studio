import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { failedToast, updatedToast } from './updateEnlargedToast';

const t = i18n.getFixedT('en');

describe('what Update Enlarged Steps says', () => {
  it('names the step, or the first and last, it placed again', () => {
    expect(updatedToast(t, [{ number: 23 }], 1)).toEqual({ tone: 'success', title: 'Updated enlarged step 23' });
    expect(updatedToast(t, [{ number: 23 }, { number: 25 }, { number: 30 }], 3)).toEqual({
      tone: 'success',
      title: 'Updated enlarged steps 23–30',
    });
  });

  it('warns when some steps took no frame, and fails when none did', () => {
    expect(updatedToast(t, [{ number: 4 }, { number: 9 }], 1)).toEqual({
      tone: 'warning',
      title: 'Updated 1 of 2 enlarged steps',
      description: 'The others couldn’t take a frame from this area.',
    });
    expect(updatedToast(t, [{ number: 4 }], 0)).toEqual({ tone: 'error', title: 'The enlarged steps couldn’t be updated' });
    expect(updatedToast(t, [], 0)).toEqual({ tone: 'error', title: 'The enlarged steps couldn’t be updated' });
  });

  it('says why when it stopped on an error', () => {
    expect(failedToast(t, new Error('The fold was refused'))).toEqual({
      tone: 'error',
      title: 'The enlarged steps couldn’t be updated',
      description: 'The fold was refused',
    });
  });
});

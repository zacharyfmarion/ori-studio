import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { failedToast, updatedToast } from './updateEnlargedToast';

const t = i18n.getFixedT('en');

describe('what an Update of enlarged steps says', () => {
  it('names the step, or the first and last of a run, it placed again', () => {
    expect(updatedToast(t, [{ number: 23 }], 1, 'en')).toEqual({ tone: 'success', title: 'Updated enlarged step 23' });
    expect(updatedToast(t, [{ number: 23 }, { number: 24 }, { number: 25 }], 3, 'en')).toEqual({
      tone: 'success',
      title: 'Updated enlarged steps 23–25',
    });
  });

  it('lists the runs when the steps placed have a gap between them: only those out of date are (review fix 4)', () => {
    expect(updatedToast(t, [{ number: 23 }, { number: 25 }, { number: 30 }], 3, 'en')).toEqual({
      tone: 'success',
      title: 'Updated enlarged steps 23, 25, and 30',
    });
    expect(updatedToast(t, [{ number: 27 }, { number: 23 }, { number: 24 }, { number: 25 }], 4, 'en')).toEqual({
      tone: 'success',
      title: 'Updated enlarged steps 23–25 and 27',
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

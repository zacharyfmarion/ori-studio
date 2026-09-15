import { beforeEach, describe, expect, it } from 'vitest';
import { useCpDetectSuggestionStore } from './cpDetectSuggestionStore';

describe('cpDetectSuggestionStore', () => {
  beforeEach(() => {
    useCpDetectSuggestionStore.getState().reset();
  });

  it('records a scored image as a pending offer', () => {
    useCpDetectSuggestionStore.getState().recordSuggestion('image-1', 0.93, true);
    expect(useCpDetectSuggestionStore.getState().suggestions['image-1']).toEqual({
      score: 0.93,
      likely: true,
      state: 'pending',
    });
  });

  it('moves an offer through open, back to pending, and to its final states', () => {
    const store = useCpDetectSuggestionStore.getState();
    store.recordSuggestion('image-1', 0.9, true);
    store.setSuggestionState('image-1', 'open');
    expect(useCpDetectSuggestionStore.getState().suggestions['image-1'].state).toBe('open');
    store.setSuggestionState('image-1', 'pending');
    expect(useCpDetectSuggestionStore.getState().suggestions['image-1'].state).toBe('pending');
    store.setSuggestionState('image-1', 'accepted');
    expect(useCpDetectSuggestionStore.getState().suggestions['image-1'].state).toBe('accepted');
  });

  it('ignores a state change for an image it never scored', () => {
    const before = useCpDetectSuggestionStore.getState().suggestions;
    useCpDetectSuggestionStore.getState().setSuggestionState('ghost', 'dismissed');
    expect(useCpDetectSuggestionStore.getState().suggestions).toBe(before);
  });

  it('counts dismissals across the session', () => {
    const store = useCpDetectSuggestionStore.getState();
    expect(store.countDismissal()).toBe(1);
    expect(store.countDismissal()).toBe(2);
    expect(useCpDetectSuggestionStore.getState().dismissals).toBe(2);
  });
});

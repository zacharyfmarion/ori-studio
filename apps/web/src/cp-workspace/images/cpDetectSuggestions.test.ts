import { beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
const reportError = vi.fn();
vi.mock('../../analytics', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../monitoring', () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
vi.mock('../../store/workspaceStore/cpDetectRuntime', () => ({
  getCpDetectClient: async () => ({ creasePatternLikelihood: async () => ({ score: 0, likely: false }) }),
  whileCpDetectClientAlive: <T,>(pending: Promise<T>) => pending,
}));

import { useCpDetectSuggestionStore } from './cpDetectSuggestionStore';
import {
  CP_DETECT_SUGGESTION_MIN_SIDE,
  noteAddedCanvasImage,
  resetCpDetectSuggestionModule,
} from './cpDetectSuggestions';

function preview(): ImageData {
  return { width: 4, height: 4, data: new Uint8ClampedArray(64), colorSpace: 'srgb' } as ImageData;
}

function deps(overrides: Partial<Parameters<typeof noteAddedCanvasImage>[1]> = {}) {
  let clock = 0;
  return {
    available: () => true,
    enabled: () => true,
    score: vi.fn(async () => ({ score: 0.91, likely: true })),
    now: () => (clock += 40),
    ...overrides,
  };
}

const image = { id: 'image-1', preview: preview(), naturalWidth: 1200, naturalHeight: 900 };

describe('noteAddedCanvasImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCpDetectSuggestionModule();
    useCpDetectSuggestionStore.getState().reset();
  });

  it('scores the image, records the offer and counts both events', async () => {
    const d = deps();
    await noteAddedCanvasImage(image, d);
    expect(d.score).toHaveBeenCalledTimes(1);
    expect(useCpDetectSuggestionStore.getState().suggestions['image-1']).toEqual({
      score: 0.91,
      likely: true,
      state: 'pending',
    });
    expect(track).toHaveBeenCalledWith('cp detect image scored', {
      verdict: 'likely',
      score_bucket: '0.9+',
      ms_bucket: '<=50',
    });
    expect(track).toHaveBeenCalledWith('cp detect suggested', { score_bucket: '0.9+' });
  });

  it('records an unlikely verdict without offering', async () => {
    await noteAddedCanvasImage(image, deps({ score: vi.fn(async () => ({ score: 0.2, likely: false })) }));
    expect(useCpDetectSuggestionStore.getState().suggestions['image-1'].likely).toBe(false);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0]).toBe('cp detect image scored');
  });

  it('does nothing when detection is unavailable on this surface', async () => {
    const d = deps({ available: () => false });
    await noteAddedCanvasImage(image, d);
    expect(d.score).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off', async () => {
    const d = deps({ enabled: () => false });
    await noteAddedCanvasImage(image, d);
    expect(d.score).not.toHaveBeenCalled();
  });

  it('does nothing for an image too small to detect, or without a preview', async () => {
    const d = deps();
    await noteAddedCanvasImage(
      { ...image, naturalWidth: CP_DETECT_SUGGESTION_MIN_SIDE - 1, naturalHeight: 2000 },
      d
    );
    await noteAddedCanvasImage({ ...image, preview: null }, d);
    expect(d.score).not.toHaveBeenCalled();
  });

  it('is silent on failure and reports only the first one', async () => {
    const d = deps({ score: vi.fn(async () => Promise.reject(new Error('worker lost'))) });
    await expect(noteAddedCanvasImage(image, d)).resolves.toBeUndefined();
    await expect(noteAddedCanvasImage({ ...image, id: 'image-2' }, d)).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    expect(useCpDetectSuggestionStore.getState().suggestions).toEqual({});
  });
});

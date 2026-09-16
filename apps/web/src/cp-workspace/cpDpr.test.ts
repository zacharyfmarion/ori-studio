import { afterEach, describe, expect, it, vi } from 'vitest';
import { CP_MAX_DPR, cpDpr } from './cpDpr';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cpDpr', () => {
  it('passes an ordinary ratio through', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    expect(cpDpr()).toBe(1);
    vi.stubGlobal('devicePixelRatio', 2);
    expect(cpDpr()).toBe(2);
  });

  it('caps a hidpi ratio at the CP fill budget', () => {
    // 3x on a 1400x900 pane is 11.3 Mpx of backing store against 5.0 at 2x,
    // before MSAA and the preserved drawing buffer.
    vi.stubGlobal('devicePixelRatio', 3);
    expect(cpDpr()).toBe(CP_MAX_DPR);
    vi.stubGlobal('devicePixelRatio', 4);
    expect(cpDpr()).toBe(CP_MAX_DPR);
  });

  it('answers 1 for a missing or nonsense ratio', () => {
    vi.stubGlobal('devicePixelRatio', 0);
    expect(cpDpr()).toBe(1);
    vi.stubGlobal('devicePixelRatio', undefined);
    expect(cpDpr()).toBe(1);
  });
});

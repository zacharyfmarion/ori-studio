import { expect, it, vi } from 'vitest';
import { trackSpatialSpreadChanged } from '../trackSpatialSpread';
const capture = vi.hoisted(() => vi.fn());
vi.mock('../runtime', () => ({ track: capture }));
it('reports only an enum state and the property surface', () => {
  trackSpatialSpreadChanged(true);
  trackSpatialSpreadChanged(false);
  expect(capture.mock.calls).toEqual([
    ['spatial spread changed', { state: 'on', via: 'properties' }],
    ['spatial spread changed', { state: 'off', via: 'properties' }],
  ]);
});

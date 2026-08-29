import { describe, expect, it } from 'vitest';
import type createREGL from 'regl';
import { createFillProgram } from './fillProgram';
import { createImageProgram } from './imageProgram';
import { createMarkerProgram } from './markerProgram';
import { createPointProgram } from './pointProgram';
import { createRegionProgram } from './regionProgram';
import { createStrokeProgram } from './strokeProgram';
import { createWedgeProgram } from './wedgeProgram';

type Regl = ReturnType<typeof createREGL>;

/**
 * A regl stand-in whose buffers reproduce the assertion that reached production:
 * destroying one twice throws, exactly as regl's own `check` does. Without the
 * `disposeOnce` guard on each program, a second dispose escapes as a thrown
 * error and takes the crease-pattern panel down to its error boundary.
 */
function fakeRegl() {
  let live = 0;
  const buffer = () => {
    let destroyed = false;
    live += 1;
    return {
      destroy() {
        if (destroyed) throw new Error('(regl) buffer must not be deleted already');
        destroyed = true;
        live -= 1;
      },
      subdata() {},
    };
  };
  // regl is callable (it builds draw commands) and carries resource factories.
  // Only `buffer` and the command call are reachable from a program's factory,
  // so the stub stops there and casts once, at this boundary.
  const regl = Object.assign(() => () => undefined, { buffer });
  return { regl: regl as unknown as Regl, liveBuffers: () => live };
}

/**
 * Each program, primed so it actually owns buffers at dispose time. Programs
 * that allocate only in `setData` would otherwise pass the idempotency check
 * without destroying anything, which proves nothing.
 */
const PROGRAMS: ReadonlyArray<readonly [string, (regl: Regl) => { dispose(): void }]> = [
  ['stroke', (regl) => createStrokeProgram(regl)],
  ['point', (regl) => createPointProgram(regl)],
  ['marker', (regl) => createMarkerProgram(regl)],
  ['wedge', (regl) => createWedgeProgram(regl)],
  ['image', (regl) => createImageProgram(regl)],
  ['region', (regl) => createRegionProgram(regl)],
  [
    'fill',
    (regl) => {
      const program = createFillProgram(regl);
      program.setData({
        position: new Float32Array([0, 0, 1, 0, 0, 1]),
        color: new Float32Array(12),
        count: 3,
        depth: new Float32Array(3),
      });
      return program;
    },
  ],
];

describe.each(PROGRAMS)('%s program', (_name, create) => {
  it('destroys its buffers on dispose', () => {
    const { regl, liveBuffers } = fakeRegl();
    const program = create(regl);
    expect(liveBuffers()).toBeGreaterThan(0);

    program.dispose();
    expect(liveBuffers()).toBe(0);
  });

  it('is idempotent: a second dispose neither throws nor double-destroys', () => {
    const { regl, liveBuffers } = fakeRegl();
    const program = create(regl);

    program.dispose();
    expect(() => program.dispose()).not.toThrow();
    expect(liveBuffers()).toBe(0);
  });
});

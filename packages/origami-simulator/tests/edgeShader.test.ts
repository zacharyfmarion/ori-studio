import { describe, expect, it } from 'vitest';
import {
  DASH_KINDS,
  EDGE_FRAG,
  EDGE_VERT,
  MAX_DASH_RUNS,
} from '../src/webgl/meshRenderer.js';
import { EDGE_CODE } from '../src/edgeCodes.js';

/**
 * What the edge shader's source has to say for the JS around it to be right.
 * WebGL2 does not exist in Node, so this cannot compile it; the browser parity
 * bench (`npm run bench:gpu-parity`, headless Chromium) links it for real and
 * renders every fixture through it. This pins the agreements that a link would
 * not catch — an array sized for three kinds still links against a four-kind
 * upload, and silently drops the aux pattern.
 */
describe('the edge shader source', () => {
  const runs = DASH_KINDS * MAX_DASH_RUNS;

  it('declares the dash arrays for every drawn kind in both stages', () => {
    for (const stage of [EDGE_VERT, EDGE_FRAG]) {
      expect(stage).toContain(`uniform float u_dashRuns[${runs}];`);
      expect(stage).toContain(`uniform int u_dashCount[${DASH_KINDS}];`);
    }
    expect(DASH_KINDS).toBe(EDGE_CODE.aux + 1);
  });

  it('reads the erode flags and distance the renderer uploads', () => {
    expect(EDGE_VERT).toContain('in float a_shrink;');
    expect(EDGE_VERT).toContain('uniform float u_erodePx;');
    // Both ends, by the bits `edgeBoundaryFlags` sets.
    expect(EDGE_VERT).toContain('(shrink & 1) != 0');
    expect(EDGE_VERT).toContain('(shrink & 2) != 0');
  });

  it('clips a hidden aux ribbon in the vertex stage and inks a shown one in its pen', () => {
    expect(EDGE_VERT).toContain(`v_assignment == ${EDGE_CODE.aux} && u_showAux < 0.5`);
    expect(EDGE_FRAG).toContain(`v_assignment == ${EDGE_CODE.aux}`);
    expect(EDGE_FRAG).toContain('uniform vec3 u_auxColor;');
  });

  it('sizes and fades every drawn kind by its own entry, indexed by assignment', () => {
    // Re-pinned: one width for border, mountain and valley and a second for
    // aux became one entry per kind. An array sized for fewer kinds would
    // still link, and draw the last kinds at whatever lies past its end.
    expect(EDGE_VERT).toContain(`uniform float u_halfWidthPx[${DASH_KINDS}];`);
    expect(EDGE_VERT).toContain('u_halfWidthPx[v_assignment]');
    expect(EDGE_FRAG).toContain(`uniform float u_creaseAlpha[${DASH_KINDS}];`);
    expect(EDGE_FRAG).toContain('u_creaseAlpha[v_assignment]');
  });

  it('centres the dash on the eroded segment, as the painter does', () => {
    // `erodeSegment` runs before `centredDashOffset` in the painter, so the
    // phase is a function of the length that is actually drawn.
    expect(EDGE_VERT).toContain('dashPhase(v_assignment, erodedLen)');
  });
});

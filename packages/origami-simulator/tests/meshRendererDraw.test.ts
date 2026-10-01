import { describe, expect, it } from 'vitest';
import {
  EDGE_QUAD_VERTICES,
  EDGE_STRIDE,
  MeshRenderer,
  buildEdgeQuads,
  erodePx,
  type MeshTopology,
  type RenderSettings,
} from '../src/webgl/meshRenderer.js';
import type { GlCore } from '../src/webgl/glCore.js';
import { viewRotation, type CameraUniforms } from '../src/webgl/camera.js';
import { EDGE_CODE } from '../src/edgeCodes.js';
import { EDGE_BOUNDARY_A, EDGE_BOUNDARY_B } from '../src/edgeBoundary.js';

// WebGL2 does not exist in Node, so this covers the *command stream* the renderer
// issues rather than the pixels it produces: which clears happen, and which slice
// of the element buffer each draw asks for. That is exactly what
// `MeshDrawOptions` decides, and it is the part a folded figure's two-pass frame
// depends on. The pixels themselves are covered by the browser parity bench.

interface DrawCall {
  count: number;
  /** Byte offset into the element buffer. */
  offset: number;
}

interface Recorder {
  gl: WebGL2RenderingContext;
  core: GlCore;
  clears: number[];
  clearColors: [number, number, number, number][];
  draws: DrawCall[];
  /** Every `drawArrays` — the edge pass — as `[first, count]`. */
  arrayDraws: [number, number][];
  /** The last scalar uploaded to each named uniform, across both programs. */
  floats: Map<string, number>;
  /** The last float array uploaded to each named uniform. */
  arrays: Map<string, number[]>;
  /** How many draws blended — `blendFuncSeparate` is the edge pass's faded path. */
  blends: number;
  /**
   * The scissor rect in force at each `clear`, or null if the test was
   * disabled. The clear has to be bounded to the viewport — see the render
   * path's own comment — and an unscissored one is not a wrong picture, only a
   * slow one, so nothing but this would notice it coming back.
   */
  clearScissors: ([number, number, number, number] | null)[];
}

/** A WebGL2 stub that records the calls this test asks questions about. */
function recorder(): Recorder {
  const clears: number[] = [];
  const clearColors: [number, number, number, number][] = [];
  const draws: DrawCall[] = [];
  const arrayDraws: [number, number][] = [];
  const floats = new Map<string, number>();
  const arrays = new Map<string, number[]>();
  let blends = 0;
  const clearScissors: ([number, number, number, number] | null)[] = [];
  let scissorEnabled = false;
  let scissorBox: [number, number, number, number] | null = null;
  const object = () => ({}) as never;
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    STATIC_DRAW: 5,
    ARRAY_BUFFER: 6,
    ELEMENT_ARRAY_BUFFER: 7,
    TRIANGLES: 8,
    UNSIGNED_INT: 9,
    FLOAT: 10,
    DEPTH_TEST: 11,
    LEQUAL: 12,
    BLEND: 13,
    SRC_ALPHA: 14,
    ONE_MINUS_SRC_ALPHA: 15,
    ONE: 16,
    FRAMEBUFFER: 17,
    TEXTURE_2D: 18,
    TEXTURE0: 100,
    TEXTURE1: 101,
    TEXTURE2: 102,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    SCISSOR_TEST: 19,

    createShader: object,
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: object,
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    createBuffer: object,
    bindBuffer: () => {},
    bufferData: () => {},
    createVertexArray: object,
    bindVertexArray: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},

    bindFramebuffer: () => {},
    viewport: () => {},
    enable: (cap: number) => {
      if (cap === 19) scissorEnabled = true;
    },
    disable: (cap: number) => {
      if (cap === 19) scissorEnabled = false;
    },
    scissor: (x: number, y: number, width: number, height: number) => {
      scissorBox = [x, y, width, height];
    },
    depthFunc: () => {},
    depthMask: () => {},
    blendFunc: () => {},
    blendFuncSeparate: () => {
      blends += 1;
    },
    clearColor: (red: number, green: number, blue: number, alpha: number) =>
      clearColors.push([red, green, blue, alpha]),
    clearDepth: () => {},
    clear: (mask: number) => {
      clears.push(mask);
      clearScissors.push(scissorEnabled ? scissorBox : null);
    },
    useProgram: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
    // A location that remembers its name, so a scalar upload can be read back
    // by the uniform it went to.
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    uniform1i: () => {},
    uniform1f: (location: { name: string } | null, value: number) => {
      if (location) floats.set(location.name, value);
    },
    uniform2f: () => {},
    uniform3f: () => {},
    uniform1fv: (location: { name: string } | null, values: Float32Array) => {
      if (location) arrays.set(location.name, [...values]);
    },
    uniform1iv: () => {},
    uniformMatrix3fv: () => {},
    drawElements: (_mode: number, count: number, _type: number, offset: number) =>
      draws.push({ count, offset }),
    drawArrays: (_mode: number, first: number, count: number) => arrayDraws.push([first, count]),
  } as unknown as WebGL2RenderingContext;

  const core = {
    gl,
    getTexture: () => ({}) as WebGLTexture,
  } as unknown as GlCore;

  return {
    gl,
    core,
    clears,
    clearColors,
    draws,
    arrayDraws,
    floats,
    arrays,
    get blends() {
      return blends;
    },
    clearScissors,
  };
}

/** Six triangles, so a sub-range can be asked for and be wrong if ignored. */
function topology(): MeshTopology {
  const faceIndices = new Uint32Array(18);
  for (let i = 0; i < faceIndices.length; i += 1) faceIndices[i] = i % 8;
  return {
    faceIndices,
    edgeIndices: new Uint32Array([0, 1]),
    edgeAssignments: new Uint8Array([1]),
    textureDim: 4,
  };
}

const CAMERA: CameraUniforms = {
  center: [0, 0, 0],
  rotation: viewRotation(0, 0),
  scale: 1,
  width: 256,
  height: 256,
  depthRange: 2,
  camDist: 4,
};

const SETTINGS: RenderSettings = {
  frontColor: [1, 1, 0],
  backColor: [1, 1, 1],
  mountainColor: [1, 0, 0],
  valleyColor: [0, 0, 1],
  borderColor: [0, 0, 0],
  lightDir: [0, 0, 1],
  background: [0, 0, 0],
  showFaces: true,
  showEdges: false,
  lighting: true,
  edgeWidthPx: 3,
  mountainWidthPx: 3,
  valleyWidthPx: 3,
  faceAlpha: 1,
};

describe('composing a frame from several MeshRenderer draws', () => {
  it('draws the whole element buffer and clears, when asked for nothing', () => {
    // The shipped call. Every existing caller passes no options, so this is the
    // statement that the solver path is unchanged.
    const { core, clears, draws } = recorder();
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null);
    expect(clears).toHaveLength(1);
    expect(draws).toEqual([{ count: 18, offset: 0 }]);
  });

  it('scissors the clear to the viewport, not the whole shared buffer', () => {
    // The buffer is shared by every inline simulation window and grow-only, so
    // it is sized to the largest window ever opened. An unscissored clear then
    // costs the whole of it on every render, whatever size the window drawing
    // is — measured flat at ~7.5ms in WebKit at 2048x2048 against ~2.8ms at
    // 512x512, and invisible in Chromium, which fast-paths a full clear.
    //
    // Only the timing changes, never the picture: the crop reads exactly this
    // rect either way. So no rendering test can catch a regression here, and
    // this is the one that has to.
    const { core, clears, clearScissors } = recorder();
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null);
    expect(clears).toHaveLength(1);
    expect(clearScissors).toEqual([[0, 0, CAMERA.width, CAMERA.height]]);
  });

  it('leaves the scissor test off once the clear is done', () => {
    // The context is shared across windows and passes, so a scissor left
    // enabled would silently clip whatever drew next.
    const { gl, core } = recorder();
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null);
    const disables: number[] = [];
    const enables: number[] = [];
    (gl as unknown as { enable: (cap: number) => void }).enable = (cap) => enables.push(cap);
    (gl as unknown as { disable: (cap: number) => void }).disable = (cap) => disables.push(cap);
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null);
    expect(enables.filter((cap) => cap === 19)).toHaveLength(1);
    expect(disables.filter((cap) => cap === 19)).toHaveLength(1);
  });

  it('skips the clear on request, so a later pass keeps the earlier one', () => {
    // Without this a second pass erases the first, which is why undetermined
    // cells could not be drawn translucently over opaque ones.
    const { core, clears } = recorder();
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null, { clear: false });
    expect(clears).toHaveLength(0);
  });

  it('draws exactly the requested run of the element buffer', () => {
    // Offsets are bytes and indices are UNSIGNED_INT, so a start of 9 indices is
    // 36 bytes. Getting that factor wrong draws the right count of the wrong
    // triangles, which looks like a geometry bug rather than an arithmetic one.
    const { core, draws } = recorder();
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null, {
      faceRange: { start: 9, count: 9 },
    });
    expect(draws).toEqual([{ count: 9, offset: 36 }]);
  });

  it('clamps a range that runs past the end rather than reading off it', () => {
    const { core, draws } = recorder();
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null, {
      faceRange: { start: 12, count: 999 },
    });
    expect(draws).toEqual([{ count: 6, offset: 48 }]);
  });

  it('clears an opaque frame to the background colour it was given', () => {
    const { core, clearColors } = recorder();
    new MeshRenderer(core, topology()).render(
      CAMERA,
      { ...SETTINGS, background: [0.2, 0.3, 0.4] },
      null
    );
    expect(clearColors).toEqual([[0.2, 0.3, 0.4, 1]]);
  });

  it('clears a transparent frame to transparent black, not to the colour at zero alpha', () => {
    // A straight-alpha context never reads the colour of a fully transparent
    // pixel, so `(r, g, b, 0)` and `(0, 0, 0, 0)` are the same frame — until the
    // browser composites the drawing buffer as premultiplied anyway, as WebKit
    // does, and adds `r, g, b` to the page behind the canvas. That is what put a
    // grey rectangle behind the welcome screen's figure on iOS Safari, so the
    // colour has to be gone by the time it reaches the driver, not merely
    // unreadable in principle.
    const { core, clearColors } = recorder();
    new MeshRenderer(core, topology()).render(
      CAMERA,
      { ...SETTINGS, background: [0.2, 0.3, 0.4], backgroundAlpha: 0 },
      null
    );
    expect(clearColors).toEqual([[0, 0, 0, 0]]);
  });

  it('issues no draw at all for an empty range', () => {
    // The case a fully-determined figure hits: its undetermined pass is empty,
    // and a zero-count drawElements is a GL call for nothing.
    const { core, draws } = recorder();
    new MeshRenderer(core, topology()).render(CAMERA, SETTINGS, null, {
      faceRange: { start: 18, count: 0 },
    });
    expect(draws).toEqual([]);
  });
});

/**
 * A square fanned from its centre (vertex 4): four border edges, one mountain
 * spoke, one aux spoke ending mid-layer at the centre, and one facet spoke.
 */
function fanTopology(): MeshTopology {
  return {
    faceIndices: new Uint32Array([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]),
    edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0, 0, 4, 1, 4, 2, 4]),
    edgeAssignments: new Uint8Array([
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.mountain,
      EDGE_CODE.aux,
      EDGE_CODE.facet,
    ]),
    textureDim: 4,
  };
}

/** The `shrink` attribute of every ribbon vertex of edge `edge`. */
function shrinkOf(quads: ReturnType<typeof buildEdgeQuads>, edge: number): number[] {
  const out: number[] = [];
  for (let v = quads.vertexStart[edge]!; v < quads.vertexStart[edge + 1]!; v += 1) {
    out.push(quads.interleaved[v * EDGE_STRIDE + 5]!);
  }
  return out;
}

describe('building the edge ribbons', () => {
  it('builds a ribbon for every border, fold and aux edge, and none for a facet', () => {
    // Phase 5: the aux crease gets its ribbon at build time and the shader
    // clips it away unless the settings show it, so the vertex offsets are
    // fixed per topology whatever the style says.
    const quads = buildEdgeQuads(fanTopology());
    expect(quads.interleaved.length / EDGE_STRIDE).toBe(6 * EDGE_QUAD_VERTICES);
    // The facet edge owns no vertices: its start equals the end of the buffer.
    expect(quads.vertexStart[6]).toBe(quads.vertexStart[7]);
    expect(quads.vertexStart[6]).toBe(6 * EDGE_QUAD_VERTICES);
    // And the aux edge's ribbon carries its code.
    const auxFirst = quads.vertexStart[5]! * EDGE_STRIDE;
    expect(quads.interleaved[auxFirst + 4]).toBe(EDGE_CODE.aux);
  });

  it('carries each edge’s erode flags on every vertex of its ribbon', () => {
    const quads = buildEdgeQuads(fanTopology());
    // The border edges never retreat.
    for (let edge = 0; edge < 4; edge += 1) expect(shrinkOf(quads, edge)).toEqual([0, 0, 0, 0, 0, 0]);
    // The mountain spoke is a fold, drawn to both its ends.
    expect(shrinkOf(quads, 4)).toEqual([0, 0, 0, 0, 0, 0]);
    // The aux spoke: on the border at the corner, and at the centre it meets
    // the mountain, which is where its layer ends.
    expect(shrinkOf(quads, 5)).toEqual(Array(6).fill(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B));
  });
});

describe('drawing the aux pass and the erode', () => {
  it('draws the aux ribbons in every edge pass; the shader clips them when hidden', () => {
    // Whether aux creases show is a uniform, not a buffer rebuild: the same
    // vertex run is drawn either way.
    const shown = recorder();
    new MeshRenderer(shown.core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, showAux: true },
      null
    );
    const hidden = recorder();
    new MeshRenderer(hidden.core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true },
      null
    );
    expect(shown.arrayDraws).toEqual([[0, 6 * EDGE_QUAD_VERTICES]]);
    expect(hidden.arrayDraws).toEqual(shown.arrayDraws);
    expect(shown.floats.get('u_showAux')).toBe(1);
    expect(hidden.floats.get('u_showAux')).toBe(0);
  });

  it('draws every kind at its own pen’s width, by assignment code', () => {
    // Re-pinned: the border, mountain and valley ribbons used to share one
    // width and only the aux pen had its own.
    const { core, arrays } = recorder();
    new MeshRenderer(core, fanTopology()).render(
      CAMERA,
      {
        ...SETTINGS,
        showEdges: true,
        showAux: true,
        edgeWidthPx: 3,
        mountainWidthPx: 2,
        valleyWidthPx: 4,
        auxWidthPx: 1.5,
      },
      null
    );
    // Half widths, ordered border, mountain, valley, aux — EDGE_CODE's order.
    expect(arrays.get('u_halfWidthPx')).toEqual([1.5, 1, 2, 0.75]);
    expect(arrays.get('u_creaseAlpha')).toEqual([1, 1, 1, 1]);
  });

  it('takes the aux width from the edge width when none is given', () => {
    const { core, arrays } = recorder();
    new MeshRenderer(core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, edgeWidthPx: 3, mountainWidthPx: 2, valleyWidthPx: 2 },
      null
    );
    expect(arrays.get('u_halfWidthPx')?.[EDGE_CODE.aux]).toBe(1.5);
  });

  it('shrinks every kind alike in a frame below its reference edge', () => {
    // An inline window at half its reference: each pen at half its width, so
    // a heavy edge stays heavier than the folds on it.
    const { core, arrays } = recorder();
    new MeshRenderer(core, fanTopology()).render(
      CAMERA,
      {
        ...SETTINGS,
        showEdges: true,
        showAux: true,
        edgeWidthPx: 4,
        mountainWidthPx: 2,
        valleyWidthPx: 3,
        auxWidthPx: 2,
        creaseWidthReferenceEdge: CAMERA.width * 2,
      },
      null
    );
    expect(arrays.get('u_halfWidthPx')).toEqual([1, 0.5, 0.75, 0.5]);
    expect(arrays.get('u_creaseAlpha')).toEqual([1, 1, 1, 1]);
  });

  it('fades a sub-pixel pen alone, and blends the pass for it', () => {
    // The raster floor is per kind: a hairline mountain draws at one pixel
    // and gives up the rest in alpha while the edge beside it is solid.
    const faded = recorder();
    new MeshRenderer(faded.core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, edgeWidthPx: 3, mountainWidthPx: 0.5, valleyWidthPx: 2 },
      null
    );
    expect(faded.arrays.get('u_halfWidthPx')).toEqual([1.5, 0.5, 1, 1.5]);
    expect(faded.arrays.get('u_creaseAlpha')).toEqual([1, 0.5, 1, 1]);
    expect(faded.blends).toBe(1);

    // A faint aux pen that is hidden draws nothing, so it blends nothing.
    const hidden = recorder();
    new MeshRenderer(hidden.core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, auxWidthPx: 0.5 },
      null
    );
    expect(hidden.arrays.get('u_creaseAlpha')).toEqual([1, 1, 1, 0.5]);
    expect(hidden.blends).toBe(0);
  });

  it('erodes by the style’s fraction of the sheet at the camera’s scale', () => {
    // The painter erodes by `erode × scene.sheet`, and the scene's sheet is the
    // world extent times the camera's scale; the frame does the same sum per
    // draw, so a zoom moves the erosion with the paper.
    const { core, floats } = recorder();
    const renderer = new MeshRenderer(core, fanTopology(), { sheet: 400 });
    renderer.render({ ...CAMERA, scale: 0.5 }, { ...SETTINGS, showEdges: true, erode: 0.01 }, null);
    expect(floats.get('u_erodePx')).toBeCloseTo(2, 12);
    renderer.render({ ...CAMERA, scale: 2 }, { ...SETTINGS, showEdges: true, erode: 0.01 }, null);
    expect(floats.get('u_erodePx')).toBeCloseTo(8, 12);
  });

  it('erodes nothing without a sheet, without an erode, or by default', () => {
    expect(erodePx({ erode: 0.01 }, 0, { scale: 2 })).toBe(0);
    expect(erodePx({ erode: 0 }, 400, { scale: 2 })).toBe(0);
    expect(erodePx({}, 400, { scale: 2 })).toBe(0);
    const { core, floats } = recorder();
    new MeshRenderer(core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, erode: 0.01 },
      null
    );
    expect(floats.get('u_erodePx')).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  EDGE_QUAD_VERTICES,
  EDGE_STRIDE,
  EDGE_VERT,
  MeshRenderer,
  buildEdgeQuads,
  erodePx,
  faceIdCorners,
  type MeshTopology,
  type RenderSettings,
} from '../src/webgl/meshRenderer.js';
import type { GlCore } from '../src/webgl/glCore.js';
import { viewRotation, type CameraUniforms } from '../src/webgl/camera.js';
import { EDGE_CODE } from '../src/edgeCodes.js';
import { EDGE_BOUNDARY_A, EDGE_BOUNDARY_B } from '../src/edgeBoundary.js';
import { faceAdjacency } from '../src/faceAdjacency.js';

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
  /**
   * The scissor rect in force at each `clear`, or null if the test was
   * disabled. The clear has to be bounded to the viewport — see the render
   * path's own comment — and an unscissored one is not a wrong picture, only a
   * slow one, so nothing but this would notice it coming back.
   */
  clearScissors: ([number, number, number, number] | null)[];
  /** Every framebuffer bound, in order; `null` is the caller's target. */
  framebuffers: unknown[];
  /** Each `bindAttribLocation`, as `name → location`, per program. */
  attributeLocations: Map<unknown, Map<string, number>>;
  /** What `checkFramebufferStatus` answers; complete unless a test says not. */
  framebufferStatus: { value: number };
}

/** A WebGL2 stub that records the calls this test asks questions about. */
function recorder(): Recorder {
  const clears: number[] = [];
  const clearColors: [number, number, number, number][] = [];
  const draws: DrawCall[] = [];
  const arrayDraws: [number, number][] = [];
  const floats = new Map<string, number>();
  const clearScissors: ([number, number, number, number] | null)[] = [];
  const framebuffers: unknown[] = [];
  const attributeLocations = new Map<unknown, Map<string, number>>();
  const framebufferStatus = { value: 20 };
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
    FRAMEBUFFER_COMPLETE: 20,
    COLOR: 21,
    DEPTH: 22,
    R32I: 23,
    RED_INTEGER: 24,
    INT: 25,
    RENDERBUFFER: 26,
    DEPTH_COMPONENT24: 27,
    COLOR_ATTACHMENT0: 28,
    DEPTH_ATTACHMENT: 29,
    TEXTURE3: 103,

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
    bindAttribLocation: (program: unknown, location: number, name: string) => {
      const names = attributeLocations.get(program) ?? new Map<string, number>();
      names.set(name, location);
      attributeLocations.set(program, names);
    },
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},

    createFramebuffer: () => ({ framebuffer: true }),
    createTexture: object,
    createRenderbuffer: object,
    bindRenderbuffer: () => {},
    renderbufferStorage: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    framebufferTexture2D: () => {},
    framebufferRenderbuffer: () => {},
    checkFramebufferStatus: () => framebufferStatus.value,
    clearBufferiv: () => {},
    clearBufferfv: () => {},
    deleteProgram: () => {},
    deleteBuffer: () => {},
    deleteVertexArray: () => {},
    deleteFramebuffer: () => {},
    deleteTexture: () => {},
    deleteRenderbuffer: () => {},

    bindFramebuffer: (_target: number, framebuffer: unknown) => framebuffers.push(framebuffer),
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
    blendFuncSeparate: () => {},
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
    uniform2i: () => {},
    uniform3f: () => {},
    uniform1fv: () => {},
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
    clearScissors,
    framebuffers,
    attributeLocations,
    framebufferStatus,
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
  creaseWidthPx: 3,
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

  it('draws the aux pen at its own width, through the raster floor', () => {
    const { core, floats } = recorder();
    new MeshRenderer(core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, showAux: true, creaseWidthPx: 3, auxWidthPx: 2 },
      null
    );
    expect(floats.get('u_halfWidthPx')).toBe(1.5);
    expect(floats.get('u_auxHalfWidthPx')).toBe(1);
    expect(floats.get('u_alpha')).toBe(1);
    expect(floats.get('u_auxAlpha')).toBe(1);
  });

  it('takes the aux width from the crease width when none is given', () => {
    const { core, floats } = recorder();
    new MeshRenderer(core, fanTopology()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, creaseWidthPx: 3 },
      null
    );
    expect(floats.get('u_auxHalfWidthPx')).toBe(1.5);
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

/** The fan, with the adjacency `meshTopologyFor` attaches. */
function fanWithAdjacency(): MeshTopology {
  const topology = fanTopology();
  return { ...topology, ...faceAdjacency(topology) };
}

/** Slots 6..9 — faces and apexes — of the first vertex of edge `edge`'s ribbon. */
function paperOf(quads: ReturnType<typeof buildEdgeQuads>, edge: number): number[] {
  const first = quads.vertexStart[edge]! * EDGE_STRIDE;
  return Array.from(quads.interleaved.slice(first + 6, first + 10));
}

describe('which paper each crease lies on', () => {
  it('carries each crease’s faces and their apexes on its ribbon', () => {
    const topology = fanWithAdjacency();
    const quads = buildEdgeQuads(topology);
    // The facet spoke (2–4) joins the two triangles either side of it into
    // one face, and no other edge joins anything.
    const groups = topology.faceGroups!;
    expect(groups[1]).toBe(groups[2]);
    expect(new Set(groups).size).toBe(3);
    // A border edge bounds one face; its apex is the fan's centre.
    expect(paperOf(quads, 0)).toEqual([groups[0], -1, 4, -1]);
    // The mountain spoke (0–4) bounds the triangles either side of it, whose
    // apexes are the corners either side.
    expect(paperOf(quads, 4)).toEqual([groups[0], groups[3], 1, 3]);
    // Every vertex of a ribbon carries the same paper.
    const first = quads.vertexStart[4]!;
    for (let v = first; v < quads.vertexStart[5]!; v += 1) {
      expect(Array.from(quads.interleaved.slice(v * EDGE_STRIDE + 6, v * EDGE_STRIDE + 10))).toEqual(
        paperOf(quads, 4)
      );
    }
  });

  it('marks every crease paperless when the topology states no adjacency', () => {
    const quads = buildEdgeQuads(fanTopology());
    for (let edge = 0; edge < 6; edge += 1) expect(paperOf(quads, edge)).toEqual([-1, -1, -1, -1]);
  });

  it('lays the ID pass’s corners out as the element buffer’s, each with its triangle’s face', () => {
    const topology = fanWithAdjacency();
    const corners = faceIdCorners(topology.faceIndices, topology.faceGroups!);
    expect(corners.length).toBe(topology.faceIndices.length * 2);
    for (let i = 0; i < topology.faceIndices.length; i += 1) {
      expect(corners[i * 2]).toBe(topology.faceIndices[i]);
      expect(corners[i * 2 + 1]).toBe(topology.faceGroups![Math.floor(i / 3)]);
    }
  });

  it('binds every attribute the edge shader declares to a location both variants share', () => {
    const { core, attributeLocations } = recorder();
    new MeshRenderer(core, fanWithAdjacency()).render(
      CAMERA,
      { ...SETTINGS, showEdges: true, creaseVisibility: 'own-face' },
      null
    );
    const declared = [...EDGE_VERT.matchAll(/^in float (a_\w+);/gm)].map((match) => match[1]!);
    expect(declared).toContain('a_face1');
    // Two edge programs (depth and own-face) and the ID pass's.
    const edgePrograms = [...attributeLocations.values()].filter((names) => names.has('a_this'));
    expect(edgePrograms).toHaveLength(2);
    for (const names of edgePrograms) {
      for (const name of declared) expect(names.has(name), name).toBe(true);
      expect(Object.fromEntries(names)).toEqual(Object.fromEntries(edgePrograms[0]!));
    }
  });
});

describe('drawing creases on their own paper', () => {
  const OWN_FACE: RenderSettings = { ...SETTINGS, showEdges: true, creaseVisibility: 'own-face' };

  it('draws the face-ID pass over the same faces, between the paint and the creases', () => {
    const { core, arrayDraws, framebuffers } = recorder();
    const renderer = new MeshRenderer(core, fanWithAdjacency());
    renderer.render(CAMERA, OWN_FACE, null, { faceRange: { start: 3, count: 6 } });
    // The ID pass draws corners 3..9 — the triangles the paint drew — and then
    // the creases draw their ribbons.
    expect(arrayDraws).toEqual([
      [3, 6],
      [0, 6 * EDGE_QUAD_VERTICES],
    ]);
    // Into its own target, and back to the caller's before the creases.
    expect(framebuffers[0]).toBeNull();
    expect(framebuffers.at(-1)).toBeNull();
    expect(framebuffers.some((framebuffer) => framebuffer !== null)).toBe(true);
    expect(renderer.creaseVisibilityInUse).toBe('own-face');
  });

  it('decides by depth unless asked, and over paper that is hidden or translucent', () => {
    for (const settings of [
      { ...OWN_FACE, creaseVisibility: 'depth' as const },
      { ...OWN_FACE, creaseVisibility: undefined },
      { ...OWN_FACE, showFaces: false },
      { ...OWN_FACE, faceAlpha: 0.5 },
    ]) {
      const { core, arrayDraws } = recorder();
      const renderer = new MeshRenderer(core, fanWithAdjacency());
      renderer.render(CAMERA, settings, null);
      expect(arrayDraws).toEqual([[0, 6 * EDGE_QUAD_VERTICES]]);
      expect(renderer.creaseVisibilityInUse).toBe('depth');
    }
  });

  it('decides by depth for a topology that states no adjacency', () => {
    const { core, arrayDraws } = recorder();
    const renderer = new MeshRenderer(core, fanTopology());
    renderer.render(CAMERA, OWN_FACE, null);
    expect(arrayDraws).toEqual([[0, 6 * EDGE_QUAD_VERTICES]]);
    expect(renderer.creaseVisibilityInUse).toBe('depth');
  });

  it('falls back to depth, and says why, when the context cannot back the ID target', () => {
    const { core, arrayDraws, framebufferStatus } = recorder();
    framebufferStatus.value = 0;
    const renderer = new MeshRenderer(core, fanWithAdjacency());
    renderer.render(CAMERA, OWN_FACE, null);
    expect(arrayDraws).toEqual([[0, 6 * EDGE_QUAD_VERTICES]]);
    expect(renderer.creaseVisibilityInUse).toBe('depth');
    expect(renderer.faceIdFailure?.message).toMatch(/incomplete/);
    // And stops asking.
    renderer.render(CAMERA, OWN_FACE, null);
    expect(arrayDraws).toHaveLength(2);
  });
});

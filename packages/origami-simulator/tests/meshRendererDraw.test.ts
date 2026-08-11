import { describe, expect, it } from 'vitest';
import { MeshRenderer, type MeshTopology, type RenderSettings } from '../src/webgl/meshRenderer.js';
import type { GlCore } from '../src/webgl/glCore.js';
import type { CameraUniforms } from '../src/webgl/camera.js';

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
  draws: DrawCall[];
}

/** A WebGL2 stub that records the calls this test asks questions about. */
function recorder(): Recorder {
  const clears: number[] = [];
  const draws: DrawCall[] = [];
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
    enable: () => {},
    disable: () => {},
    depthFunc: () => {},
    depthMask: () => {},
    blendFunc: () => {},
    blendFuncSeparate: () => {},
    clearColor: () => {},
    clearDepth: () => {},
    clear: (mask: number) => clears.push(mask),
    useProgram: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
    getUniformLocation: object,
    uniform1i: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    uniform3f: () => {},
    uniform1fv: () => {},
    uniform1iv: () => {},
    drawElements: (_mode: number, count: number, _type: number, offset: number) =>
      draws.push({ count, offset }),
    drawArrays: () => {},
  } as unknown as WebGL2RenderingContext;

  const core = {
    gl,
    getTexture: () => ({}) as WebGLTexture,
  } as unknown as GlCore;

  return { gl, core, clears, draws };
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
  cosYaw: 1,
  sinYaw: 0,
  cosPitch: 1,
  sinPitch: 0,
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

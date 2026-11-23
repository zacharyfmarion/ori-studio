import { describe, expect, it } from 'vitest';
import { GlCore, MeshRenderer, cameraUniforms, type MeshTopology, type RenderSettings } from '@treemaker/origami-simulator';
import {
  UnmodeledShaderError,
  recordedPerspectiveDepth,
  recordingCanvas,
  replayFrame,
} from './meshRendererReplay.testSupport';

/** One triangle with its three sides as creases, facing the camera. */
const TOPOLOGY: MeshTopology = {
  faceIndices: new Uint32Array([0, 1, 2]),
  edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 0]),
  edgeAssignments: new Uint8Array([0, 1, 2]),
  textureDim: 2,
};
const POSITIONS = new Float32Array([-1, 0, -1, 1, 0, -1, 0, 0, 1, 0, 0, 0]);

const SETTINGS: RenderSettings = {
  frontColor: [1, 1, 1],
  backColor: [0.8, 0.8, 0.8],
  mountainColor: [0, 0, 0],
  valleyColor: [0, 0, 0],
  borderColor: [0, 0, 0],
  lightDir: [0, 0, 1],
  background: [1, 1, 1],
  showFaces: true,
  showEdges: true,
  lighting: false,
  edgeWidthPx: 2,
  mountainWidthPx: 2,
  valleyWidthPx: 2,
  faceAlpha: 1,
};

function drawn(options: { perspectiveDepth?: boolean } = {}) {
  const { canvas, recording } = recordingCanvas();
  const core = GlCore.create(canvas);
  if (!core) throw new Error('no context on the recording canvas');
  // The textures the renderer reads positions from, as FoldedMeshSource makes them.
  const packed = new Float32Array(16);
  for (let i = 0; i < 4; i += 1) packed.set(POSITIONS.subarray(i * 3, i * 3 + 3), i * 4);
  core.createTexture('u_originalPosition', { width: 2, height: 2, data: packed });
  core.createTexture('u_lastPosition', { width: 2, height: 2, data: null });
  core.createTexture('u_lastVelocity', { width: 2, height: 2, data: null });
  const camera = cameraUniforms({ yaw: 0, pitch: 0.6, zoom: 1 }, [0, 0, 0], 1.5, 200, 200);
  new MeshRenderer(core, TOPOLOGY, options).render(camera, SETTINGS, null);
  return { recording, frame: () => replayFrame(recording, { faceOfTriangle: () => 7 }) };
}

describe('the mesh renderer replay', () => {
  it("replays a frame the renderer draws, its paper and its creases' ink", () => {
    const { frame } = drawn();
    const replayed = frame();
    expect(replayed.face.filter((face) => face === 7).length).toBeGreaterThan(100);
    expect(replayed.lines.map((line) => line.code).sort()).toEqual([0, 1, 2]);
    expect(replayed.ink.some((ink) => ink >= 0)).toBe(true);
  });

  it('reads the depth mode from the draws, as the renderer was built', () => {
    expect(recordedPerspectiveDepth(drawn().recording)).toBe(false);
    expect(recordedPerspectiveDepth(drawn({ perspectiveDepth: true }).recording)).toBe(true);
    expect(drawn({ perspectiveDepth: true }).frame().depth.perspective).toEqual([true]);
  });

  it('refuses a frame drawn by a program it does not read, naming what is new', () => {
    const { canvas, recording } = recordingCanvas();
    const gl = canvas.getContext('webgl2') as unknown as WebGL2RenderingContext;
    // An edge program like the mesh renderer's, with one function it does not have.
    const program = gl.createProgram()!;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, 'in float a_assignment; uniform float u_depthBias; float faceDepth(int index, vec3 view){ return 0.0; } void main(){}'],
      [gl.FRAGMENT_SHADER, 'out vec4 fragColor; void main(){ fragColor = vec4(0.0); }'],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(36), gl.STATIC_DRAW);
    for (const [offset, name] of ['a_this', 'a_a', 'a_b', 'a_side', 'a_assignment', 'a_shrink'].entries()) {
      gl.vertexAttribPointer(gl.getAttribLocation(program, name), 1, gl.FLOAT, false, 24, offset * 4);
    }
    gl.viewport(0, 0, 100, 100);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    expect(() => replayFrame(recording, { faceOfTriangle: () => 0 })).toThrow(UnmodeledShaderError);
    expect(() => recordedPerspectiveDepth(recording)).toThrow(UnmodeledShaderError);
    try {
      replayFrame(recording, { faceOfTriangle: () => 0 });
    } catch (error) {
      expect((error as UnmodeledShaderError).reason).toBe('its edge shader declares faceDepth, which the replay does not read');
    }
  });
});

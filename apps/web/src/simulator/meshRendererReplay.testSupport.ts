/**
 * The mesh renderer's frames, drawn again on the CPU from what it asked the
 * GPU to draw. Test support: imported by tests and the diagram corpus
 * (`diagram/dataset/`) only.
 *
 * {@link recordingCanvas} stands in for a canvas. Its WebGL2 context draws
 * nothing; it keeps every texture, buffer, uniform, depth state and draw call
 * it is handed, in order. The live views' own code builds on it as it builds
 * on a GPU — `FoldedMeshSource.create` for a 3D figure, `new WebglSolver` for
 * a simulated one — and renders a frame as the view renders it. The recording
 * then holds that frame as the view drew it: its passes and their ranges, the
 * depth mode, the crease bias and depth write, the pens, the erode, the aux
 * switch and the camera, all as uniforms and GL state. None of it is restated
 * here, so a change to any of them in the live view reaches the replay.
 *
 * {@link replayFrame} rasterises the recorded draws through the mesh
 * renderer's shaders read as arithmetic — `FACE_VERT`, `EDGE_VERT` and
 * `EDGE_FRAG` in `packages/origami-simulator/src/webgl/meshRenderer.ts` —
 * with a depth buffer tested and written as the recorded state says. What it
 * keeps is two buffers rather than a colour: the paper on top at each pixel,
 * faces only, and which line's ink the frame shows there. That is what lets a
 * check ask whether a line shows only on its own paper.
 *
 * What it cannot see: a shader that no longer says what this reads it as
 * (the record carries the shaders' digest, so a side whose shaders differ
 * says so), float32 precision, antialiasing, the GPU solver, and everything
 * after the draw: bitmap presentation, the viewport's stage.
 */
import { createHash } from 'node:crypto';
import { EDGE_CODE } from '@treemaker/origami-simulator';

/** The WebGL2 enums the recording reads, at their real values. */
const GL = {
  TRIANGLES: 0x0004,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  TEXTURE0: 0x84c0,
  DEPTH_TEST: 0x0b71,
  BLEND: 0x0be2,
  SCISSOR_TEST: 0x0c11,
  STENCIL_TEST: 0x0b90,
  CULL_FACE: 0x0b44,
  NEVER: 0x0200,
  LESS: 0x0201,
  EQUAL: 0x0202,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  NOTEQUAL: 0x0205,
  GEQUAL: 0x0206,
  ALWAYS: 0x0207,
  COLOR_BUFFER_BIT: 0x4000,
  DEPTH_BUFFER_BIT: 0x0100,
  FRAMEBUFFER: 0x8d40,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  FRAMEBUFFER_BINDING: 0x8ca6,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  MAX_TEXTURE_SIZE: 0x0d33,
  DEPTH_BITS: 0x0d56,
  STENCIL_BITS: 0x0d57,
  NO_ERROR: 0,
} as const;

interface RecordedTexture {
  width: number;
  height: number;
  data: Float32Array | null;
}

interface RecordedBuffer {
  data: ArrayBufferView | null;
}

interface RecordedAttribute {
  buffer: RecordedBuffer | null;
  stride: number;
  offset: number;
}

interface RecordedVao {
  element: RecordedBuffer | null;
  attributes: Map<number, RecordedAttribute>;
}

interface RecordedShader {
  type: number;
  source: string;
}

/** What a program draws, told from its shaders: the face pass, the crease pass, or anything else (the solver's). */
export type RecordedProgramKind = 'face' | 'edge' | 'other';

interface RecordedProgram {
  shaders: RecordedShader[];
  kind: RecordedProgramKind;
  uniforms: Map<string, UniformValue>;
  attributes: Map<string, number>;
}

interface RecordedLocation {
  program: RecordedProgram;
  name: string;
}

type UniformValue = number | readonly number[] | { matrix: readonly number[]; transpose: boolean };

interface DrawState {
  depthTest: boolean;
  depthMask: boolean;
  depthFunc: number;
  blend: boolean;
  colorMask: boolean;
  viewport: readonly [number, number, number, number];
}

interface DrawSnapshot {
  /** The program that drew it. */
  program: RecordedProgram;
  uniforms: ReadonlyMap<string, UniformValue>;
  /** The texture on each unit, as it was at the draw. */
  units: ReadonlyArray<RecordedTexture | null>;
  state: DrawState;
}

/** One command of a recorded frame, in the order the renderer issued it. */
export type RecordedCommand =
  | { kind: 'clear'; color: boolean; depth: boolean }
  | (DrawSnapshot & { kind: 'faces'; indices: Uint32Array; first: number; count: number })
  | (DrawSnapshot & {
      kind: 'edges';
      vertices: Float32Array;
      /** Per attribute, its first float and the stride, in floats. */
      layout: Record<EdgeAttribute, { offset: number; stride: number }>;
      first: number;
      count: number;
    });

const EDGE_ATTRIBUTES = ['a_this', 'a_a', 'a_b', 'a_side', 'a_assignment', 'a_shrink'] as const;
type EdgeAttribute = (typeof EDGE_ATTRIBUTES)[number];

export interface Recording {
  /** The draws to the default framebuffer, in order: what a frame shows. */
  commands: RecordedCommand[];
  /** The face and crease programs linked so far, by kind, with the digest of their code; `face:… edge:…`, or null before either was. */
  shaders: () => string | null;
  /** The same programs, each with what it declares and why it would be refused (null when it is modeled). */
  programs: () => Array<{ kind: RecordedProgramKind; digest: string; names: string[]; refusal: string | null }>;
  /** Forget the commands so far: the next frame starts clean. Textures, buffers and uniforms stay. */
  reset: () => void;
}

function programKind(shaders: readonly RecordedShader[]): RecordedProgramKind {
  const vertex = shaders.find((shader) => shader.type === GL.VERTEX_SHADER)?.source ?? '';
  const fragment = shaders.find((shader) => shader.type === GL.FRAGMENT_SHADER)?.source ?? '';
  if (vertex.includes('a_assignment') && vertex.includes('u_depthBias')) return 'edge';
  if (vertex.includes('gl_VertexID') && fragment.includes('u_frontColor')) return 'face';
  return 'other';
}

/** A program's code with its comments and layout taken out: what decides how it draws. */
function glslCode(program: RecordedProgram): string {
  const source = (type: number) => program.shaders.find((shader) => shader.type === type)?.source ?? '';
  return `${source(GL.VERTEX_SHADER)}\n${source(GL.FRAGMENT_SHADER)}`
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The digest of a program's code, vertex shader then fragment. */
function programDigest(program: RecordedProgram): string {
  return createHash('sha256').update(glslCode(program)).digest('hex').slice(0, 12);
}

/**
 * The programs this replay reads as arithmetic, by the digest of their code
 * (`programDigest`). Read off `meshRenderer.ts`, whose GLSL changed once
 * between v0.10.0 and main (dd7222a03):
 *
 * - **face** (`FACE_VERT`, `FACE_FRAG`): unchanged over that span;
 * - **edge** (`EDGE_VERT`, `EDGE_FRAG`): v0.10.0's, and since 5b2b40eab the
 *   same with aux lines drawn on the paper (`u_virtual`, `fetchPosition` of
 *   a virtual vertex), unchanged to main.
 *
 * A frame drawn by any other program is refused, never replayed as one of
 * these ({@link UnmodeledShaderError}). A change to the mesh renderer's GLSL
 * comes here: read the new code into {@link replayFrame}, then add its digest.
 */
export const MODELED_PROGRAMS: Readonly<Record<'face' | 'edge', ReadonlySet<string>>> = {
  face: new Set(['1f7073b7efc2']),
  edge: new Set([
    // v0.10.0
    '78815e082893',
    // 5b2b40eab to main
    '63a25bfa2319',
  ]),
};

/** The functions and uniforms the modeled programs declare, so a refusal can name what is new. */
const MODELED_NAMES: ReadonlySet<string> = new Set([
  ...['dashOn', 'dashPhase', 'fetchPosition', 'hueToRgb', 'main', 'nodePosition', 'projectDepth', 'projectNdc'],
  ...['shadeFor', 'toNdc', 'toNdcDepth', 'toView', 'virtualTexel'],
  ...['u_alpha', 'u_auxColor', 'u_backColor', 'u_borderColor', 'u_camDist', 'u_center', 'u_creaseAlpha'],
  ...['u_dashCount', 'u_dashRuns', 'u_depthBias', 'u_depthRange', 'u_displacementScale', 'u_erodePx'],
  ...['u_frontColor', 'u_halfWidthPx', 'u_lastPosition', 'u_lastVelocity', 'u_lightDir', 'u_lighting'],
  ...['u_mountainColor', 'u_originalPosition', 'u_perspectiveDepth', 'u_scale', 'u_showAux', 'u_strainClip'],
  ...['u_strainMode', 'u_textureDim', 'u_tintColor', 'u_tintMix', 'u_valleyColor', 'u_view', 'u_viewport'],
  ...['u_virtual', 'u_virtualDim', 'u_virtualStart'],
]);

/** What a program declares: its functions and uniforms, by name. */
function declaredNames(program: RecordedProgram): string[] {
  const code = glslCode(program);
  const functions = [...code.matchAll(/\b(?:void|float|int|uint|bool|[iu]?vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g)];
  const uniforms = [...code.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+([A-Za-z_]\w*)/g)];
  return [...new Set([...functions, ...uniforms].map((match) => match[1]!))].sort();
}

/**
 * A live view drew with a program this replay does not read: replaying it
 * as one it does would guess. The Pose check reports the view as not
 * compared, with {@link reason}.
 */
export class UnmodeledShaderError extends Error {
  constructor(readonly reason: string) {
    super(`The CPU replay does not model the live view's shaders: ${reason}`);
    this.name = 'UnmodeledShaderError';
  }
}

/** Why a program is refused, or null when the replay models it. */
function refusalOf(program: RecordedProgram): string | null {
  if (program.kind === 'other') return null;
  const digest = programDigest(program);
  if (MODELED_PROGRAMS[program.kind].has(digest)) return null;
  const unknown = declaredNames(program).filter((name) => !MODELED_NAMES.has(name));
  return unknown.length > 0
    ? `its ${program.kind} shader declares ${unknown.join(', ')}, which the replay does not read`
    : `its ${program.kind} shader's code (${digest}) is not one the replay reads`;
}

function copyView(data: unknown): ArrayBufferView | null {
  if (data == null || typeof data === 'number') return null;
  if (data instanceof Float32Array) return new Float32Array(data);
  if (data instanceof Uint32Array) return new Uint32Array(data);
  if (data instanceof Uint16Array) return new Uint16Array(data);
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof Int32Array) return new Int32Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return null;
}

/**
 * A canvas whose WebGL2 context records instead of drawing. Every enum is a
 * number, every create returns an object, every query a plausible answer:
 * a complete framebuffer, 24 depth bits, a 16384 texture limit. Calls the
 * replay has no use for do nothing.
 */
export function recordingCanvas(width = 2048, height = 2048): { canvas: OffscreenCanvas; recording: Recording } {
  const commands: RecordedCommand[] = [];
  const programs: RecordedProgram[] = [];
  const defaultVao: RecordedVao = { element: null, attributes: new Map() };
  let vao = defaultVao;
  let arrayBuffer: RecordedBuffer | null = null;
  let program: RecordedProgram | null = null;
  let framebuffer: object | null = null;
  let activeUnit = 0;
  const units: Array<RecordedTexture | null> = new Array(16).fill(null);
  const enabled = new Set<number>();
  let depthMask = true;
  let depthFunc: number = GL.LESS;
  let colorMask = true;
  let viewport: readonly [number, number, number, number] = [0, 0, width, height];
  const constants = new Map<string, number>(Object.entries(GL));
  // `TEXTURE0 + n` is how a unit is named, so every unit needs its real value.
  for (let unit = 1; unit < 32; unit += 1) constants.set(`TEXTURE${unit}`, GL.TEXTURE0 + unit);
  let nextConstant = 0x100000;

  const snapshot = (): DrawSnapshot => ({
    program: program!,
    uniforms: new Map(program!.uniforms),
    units: units.map((texture) => (texture ? { ...texture } : null)),
    state: {
      depthTest: enabled.has(GL.DEPTH_TEST),
      depthMask,
      depthFunc,
      blend: enabled.has(GL.BLEND),
      colorMask,
      viewport,
    },
  });
  const set = (location: RecordedLocation | null, value: UniformValue) => {
    location?.program.uniforms.set(location.name, value);
  };

  const methods: Record<string, (...args: never[]) => unknown> = {
    getExtension: () => ({}),
    isContextLost: () => false,
    getError: () => GL.NO_ERROR,
    getParameter: (name: number) => {
      if (name === GL.MAX_TEXTURE_SIZE) return 16384;
      if (name === GL.DEPTH_BITS) return 24;
      if (name === GL.STENCIL_BITS) return 8;
      if (name === GL.FRAMEBUFFER_BINDING) return framebuffer;
      return 0;
    },
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    enable: (cap: number) => enabled.add(cap),
    disable: (cap: number) => enabled.delete(cap),
    depthMask: (flag: boolean) => {
      depthMask = flag;
    },
    depthFunc: (func: number) => {
      depthFunc = func;
    },
    colorMask: (r: boolean, g: boolean, b: boolean) => {
      colorMask = r || g || b;
    },
    viewport: (x: number, y: number, w: number, h: number) => {
      viewport = [x, y, w, h];
    },
    clear: (mask: number) => {
      if (framebuffer !== null) return;
      commands.push({ kind: 'clear', color: (mask & GL.COLOR_BUFFER_BIT) !== 0, depth: (mask & GL.DEPTH_BUFFER_BIT) !== 0 });
    },
    createBuffer: (): RecordedBuffer => ({ data: null }),
    bindBuffer: (target: number, buffer: RecordedBuffer | null) => {
      if (target === GL.ARRAY_BUFFER) arrayBuffer = buffer;
      else if (target === GL.ELEMENT_ARRAY_BUFFER) vao.element = buffer;
    },
    bufferData: (target: number, data: unknown) => {
      const buffer = target === GL.ARRAY_BUFFER ? arrayBuffer : target === GL.ELEMENT_ARRAY_BUFFER ? vao.element : null;
      if (buffer) buffer.data = copyView(data);
    },
    createVertexArray: (): RecordedVao => ({ element: null, attributes: new Map() }),
    bindVertexArray: (next: RecordedVao | null) => {
      vao = next ?? defaultVao;
    },
    vertexAttribPointer: (index: number, _size: number, _type: number, _normalized: boolean, stride: number, offset: number) => {
      vao.attributes.set(index, { buffer: arrayBuffer, stride, offset });
    },
    createTexture: (): RecordedTexture => ({ width: 0, height: 0, data: null }),
    activeTexture: (unit: number) => {
      activeUnit = unit - GL.TEXTURE0;
    },
    bindTexture: (_target: number, texture: RecordedTexture | null) => {
      units[activeUnit] = texture;
    },
    texImage2D: (...args: unknown[]) => {
      const texture = units[activeUnit];
      if (!texture || args.length < 9) return;
      texture.width = Number(args[3]);
      texture.height = Number(args[4]);
      const data = args[8];
      texture.data = data instanceof Float32Array ? new Float32Array(data) : null;
    },
    createFramebuffer: () => ({}),
    bindFramebuffer: (_target: number, next: object | null) => {
      framebuffer = next;
    },
    createShader: (type: number): RecordedShader => ({ type, source: '' }),
    shaderSource: (shader: RecordedShader, source: string) => {
      shader.source = source;
    },
    createProgram: (): RecordedProgram => {
      const created: RecordedProgram = { shaders: [], kind: 'other', uniforms: new Map(), attributes: new Map() };
      programs.push(created);
      return created;
    },
    attachShader: (target: RecordedProgram, shader: RecordedShader) => {
      target.shaders.push(shader);
    },
    linkProgram: (target: RecordedProgram) => {
      target.kind = programKind(target.shaders);
    },
    bindAttribLocation: (target: RecordedProgram, index: number, name: string) => {
      target.attributes.set(name, index);
    },
    getAttribLocation: (target: RecordedProgram, name: string) => {
      const known = target.attributes.get(name);
      if (known !== undefined) return known;
      const index = target.attributes.size;
      target.attributes.set(name, index);
      return index;
    },
    getUniformLocation: (target: RecordedProgram, name: string): RecordedLocation => ({ program: target, name }),
    useProgram: (next: RecordedProgram | null) => {
      program = next;
    },
    uniform1i: (location: RecordedLocation | null, value: number) => set(location, value),
    uniform1f: (location: RecordedLocation | null, value: number) => set(location, value),
    uniform2f: (location: RecordedLocation | null, x: number, y: number) => set(location, [x, y]),
    uniform3f: (location: RecordedLocation | null, x: number, y: number, z: number) => set(location, [x, y, z]),
    uniform1fv: (location: RecordedLocation | null, values: ArrayLike<number>) => set(location, Array.from(values)),
    uniform1iv: (location: RecordedLocation | null, values: ArrayLike<number>) => set(location, Array.from(values)),
    uniformMatrix3fv: (location: RecordedLocation | null, transpose: boolean, values: ArrayLike<number>) =>
      set(location, { matrix: Array.from(values), transpose }),
    drawElements: (mode: number, count: number, _type: number, offset: number) => {
      if (framebuffer !== null || program?.kind !== 'face' || mode !== GL.TRIANGLES) return;
      const indices = vao.element?.data;
      if (!(indices instanceof Uint32Array)) return;
      commands.push({ kind: 'faces', indices, first: offset / 4, count, ...snapshot() });
    },
    drawArrays: (mode: number, first: number, count: number) => {
      if (framebuffer !== null || program?.kind !== 'edge' || mode !== GL.TRIANGLES) return;
      const layout = {} as Record<EdgeAttribute, { offset: number; stride: number }>;
      let vertices: Float32Array | null = null;
      for (const name of EDGE_ATTRIBUTES) {
        const location = program.attributes.get(name);
        const attribute = location === undefined ? undefined : vao.attributes.get(location);
        const data = attribute?.buffer?.data;
        if (!attribute || !(data instanceof Float32Array)) return;
        vertices = data;
        layout[name] = { offset: attribute.offset / 4, stride: attribute.stride / 4 };
      }
      if (!vertices) return;
      commands.push({ kind: 'edges', vertices, layout, first, count, ...snapshot() });
    },
  };

  const gl = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string') return undefined;
        if (name === 'drawingBufferWidth') return width;
        if (name === 'drawingBufferHeight') return height;
        const method = methods[name];
        if (method) return method;
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
          let value = constants.get(name);
          if (value === undefined) {
            value = nextConstant++;
            constants.set(name, value);
          }
          return value;
        }
        return () => undefined;
      },
    }
  );
  const canvas = {
    width,
    height,
    getContext: (kind: string) => (kind === 'webgl2' ? gl : null),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as OffscreenCanvas;
  const linked = () =>
    programs
      .filter((program) => program.kind !== 'other')
      .map((program) => ({ kind: program.kind, digest: programDigest(program), names: declaredNames(program), refusal: refusalOf(program) }));
  const recording: Recording = {
    commands,
    shaders: () => {
      const kinds = [...new Set(linked().map(({ kind, digest }) => `${kind}:${digest}`))].sort();
      return kinds.length > 0 ? kinds.join(' ') : null;
    },
    programs: linked,
    reset: () => {
      commands.length = 0;
    },
  };
  return { canvas, recording };
}

/* ------------------------------------------------------------------------
 * The replay
 * --------------------------------------------------------------------- */

/** One line the frame drew, by the two ends its ribbon names. */
export interface ReplayedLine {
  /** The ribbon's ends as the crease buffer names them: nodes, or virtual vertices past `u_virtualStart`. */
  a: number;
  b: number;
  /** Its `EDGE_CODE`. */
  code: number;
  /** The ends' world positions. */
  worldA: readonly [number, number, number];
  worldB: readonly [number, number, number];
  /** Its eroded ends on screen, px, y down, and half its ribbon's width. */
  from: readonly [number, number];
  to: readonly [number, number];
  halfWidthPx: number;
  /** Whether its dash is on this far along it, px from `from`. */
  dashOn: (alongPx: number) => boolean;
}

export interface ReplayedFrame {
  width: number;
  height: number;
  /** The paper on top at each pixel, faces only: `faceOfTriangle`'s answer, or -1. Row by row from the top. */
  face: Int32Array;
  /** Which side of the paper shows there: 1 front, -1 back, 0 none. */
  side: Int8Array;
  /** The line whose ink the frame shows at each pixel, an index into {@link lines}, or -1. */
  ink: Int32Array;
  lines: ReplayedLine[];
  /** How the draws tested depth, as their uniforms and state said: one entry per distinct value. */
  depth: { perspective: boolean[]; creaseBias: number[]; creaseWritesDepth: boolean[] };
}

export interface ReplayOptions {
  /** The paper face a triangle is, by its place in the element buffer (index / 3). */
  faceOfTriangle: (triangle: number) => number;
  /**
   * Node positions, three per node, in place of the position textures: a
   * frame whose solver this replay does not run. Virtual vertices are still
   * placed from the recorded table, over these.
   */
  positions?: Float32Array;
}

interface Uniforms {
  get(name: string): UniformValue | undefined;
}

const num = (uniforms: Uniforms, name: string, fallback = 0): number => {
  const value = uniforms.get(name);
  return typeof value === 'number' ? value : fallback;
};
const vec = (uniforms: Uniforms, name: string): readonly number[] => {
  const value = uniforms.get(name);
  return Array.isArray(value) ? value : [];
};

/** The shaders' camera and position fetch, as the draw's uniforms set them. */
class ShaderView {
  readonly center: readonly number[];
  readonly rows: [number, number, number, number, number, number, number, number, number];
  readonly scale: number;
  readonly halfViewport: readonly [number, number];
  readonly depthRange: number;
  readonly camDist: number;
  readonly perspective: boolean;
  readonly displacementScale: number;
  private readonly textureDim: number;
  private readonly last: RecordedTexture | null;
  private readonly original: RecordedTexture | null;
  private readonly virtualTable: RecordedTexture | null;
  private readonly virtualStart: number;
  private readonly virtualDim: number;

  constructor(
    private readonly snapshot: DrawSnapshot,
    private readonly positions: Float32Array | undefined
  ) {
    const u = snapshot.uniforms;
    this.center = vec(u, 'u_center');
    const view = u.get('u_view');
    const matrix = view && typeof view === 'object' && 'matrix' in view ? view : { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], transpose: true };
    const m = matrix.matrix;
    // `uniformMatrix3fv(…, transpose, m)`: transposed, `m` is row-major as the shader reads it; not, column-major.
    this.rows = matrix.transpose
      ? [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!]
      : [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
    this.scale = num(u, 'u_scale');
    const viewport = vec(u, 'u_viewport');
    this.halfViewport = [(viewport[0] ?? snapshot.state.viewport[2]) * 0.5, (viewport[1] ?? snapshot.state.viewport[3]) * 0.5];
    this.depthRange = num(u, 'u_depthRange', 1);
    this.camDist = num(u, 'u_camDist', 1);
    this.perspective = num(u, 'u_perspectiveDepth') > 0.5;
    this.displacementScale = num(u, 'u_displacementScale', 1);
    this.textureDim = Math.max(1, num(u, 'u_textureDim', 1));
    const unit = (name: string) => snapshot.units[num(u, name, -1)] ?? null;
    this.last = unit('u_lastPosition');
    this.original = unit('u_originalPosition');
    this.virtualTable = unit('u_virtual');
    this.virtualStart = u.get('u_virtualStart') === undefined ? Number.MAX_SAFE_INTEGER : num(u, 'u_virtualStart');
    this.virtualDim = Math.max(1, num(u, 'u_virtualDim', 1));
  }

  private texel(texture: RecordedTexture | null, x: number, y: number): [number, number, number] {
    const data = texture?.data;
    if (!data || x < 0 || y < 0 || x >= texture.width || y >= texture.height) return [0, 0, 0];
    const at = (y * texture.width + x) * 4;
    return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
  }

  /** `nodePosition` (EDGE_VERT) and FACE_VERT's `fetchPosition`: displacement times its scale, plus the rest position. */
  node(index: number): [number, number, number] {
    if (this.positions) {
      return [this.positions[index * 3] ?? 0, this.positions[index * 3 + 1] ?? 0, this.positions[index * 3 + 2] ?? 0];
    }
    const x = index % this.textureDim;
    const y = Math.floor(index / this.textureDim);
    const last = this.texel(this.last, x, y);
    const original = this.texel(this.original, x, y);
    return [
      this.displacementScale * last[0] + original[0],
      this.displacementScale * last[1] + original[1],
      this.displacementScale * last[2] + original[2],
    ];
  }

  /** EDGE_VERT's `fetchPosition`: a node, or a point of a triangle placed by its weights. */
  fetch(index: number): [number, number, number] {
    if (index < this.virtualStart) return this.node(index);
    const at = (index - this.virtualStart) * 2;
    const nodes = this.texel(this.virtualTable, at % this.virtualDim, Math.floor(at / this.virtualDim));
    const weights = this.texel(this.virtualTable, (at + 1) % this.virtualDim, Math.floor((at + 1) / this.virtualDim));
    const out: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
      const p = this.node(Math.round(nodes[k]!));
      out[0] += weights[k]! * p[0];
      out[1] += weights[k]! * p[1];
      out[2] += weights[k]! * p[2];
    }
    return out;
  }

  toView(p: readonly number[]): [number, number, number] {
    const dx = p[0]! - (this.center[0] ?? 0);
    const dy = p[1]! - (this.center[1] ?? 0);
    const dz = p[2]! - (this.center[2] ?? 0);
    const m = this.rows;
    return [m[0] * dx + m[1] * dy + m[2] * dz, m[3] * dx + m[4] * dy + m[5] * dz, m[6] * dx + m[7] * dy + m[8] * dz];
  }

  /** `toNdc` times the half viewport: px from the frame's centre, y up. */
  toPx(view: readonly number[]): [number, number] {
    const persp = this.camDist / Math.max(this.camDist - view[2]!, 0.001);
    return [view[0]! * persp * this.scale, view[1]! * persp * this.scale];
  }

  toNdcDepth(depth: number): number {
    return ndcDepth(depth, this, this.perspective);
  }
}

const passesDepth = (func: number, incoming: number, stored: number): boolean => {
  switch (func) {
    case GL.NEVER:
      return false;
    case GL.LESS:
      return incoming < stored;
    case GL.EQUAL:
      return incoming === stored;
    case GL.LEQUAL:
      return incoming <= stored;
    case GL.GREATER:
      return incoming > stored;
    case GL.NOTEQUAL:
      return incoming !== stored;
    case GL.GEQUAL:
      return incoming >= stored;
    default:
      return true;
  }
};

/** A rasterised vertex: frame px (y down), NDC depth and one varying. */
type Fragmentable = readonly [x: number, y: number, z: number, varying: number];

/**
 * Pixel centres a triangle covers, its depth and varying interpolated across
 * the screen — exactly so for depth, which is affine in screen space after the
 * divide, and for the crease pass, whose `w` is 1.
 */
function rasterise(
  width: number,
  height: number,
  p: readonly [Fragmentable, Fragmentable, Fragmentable],
  fragment: (at: number, z: number, varying: number) => void
): void {
  const [[ax, ay, az, av], [bx, by, bz, bv], [cx, cy, cz, cv]] = p;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (!(Math.abs(area) > 1e-12)) return;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let py = minY; py <= maxY; py += 1) {
    const sy = py + 0.5;
    for (let px = minX; px <= maxX; px += 1) {
      const sx = px + 0.5;
      const wb = ((sx - ax) * (cy - ay) - (sy - ay) * (cx - ax)) / area;
      const wc = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
      const wa = 1 - wb - wc;
      if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
      fragment(py * width + px, wa * az + wb * bz + wc * cz, wa * av + wb * bv + wc * cv);
    }
  }
}

/** EDGE_FRAG's `dashOn`, for one kind, from the draw's dash uniforms. */
function dashTest(uniforms: Uniforms, kind: number): (alongPx: number) => boolean {
  const runs = vec(uniforms, 'u_dashRuns');
  const counts = vec(uniforms, 'u_dashCount');
  const perKind = runs.length / Math.max(1, counts.length);
  const count = counts[kind] ?? 0;
  const pattern = runs.slice(kind * perKind, kind * perKind + count);
  const total = pattern.reduce((sum, run) => sum + run, 0);
  if (count <= 0 || !(total > 0)) return () => true;
  return (alongPx) => {
    const position = ((alongPx % total) + total) % total;
    let acc = 0;
    for (let i = 0; i < pattern.length; i += 1) {
      acc += pattern[i]!;
      if (position < acc) return i % 2 === 0;
    }
    return true;
  };
}

/** EDGE_VERT's `dashPhase`: where the pattern starts so it is centred on a line this long. */
function dashPhase(uniforms: Uniforms, kind: number, length: number): number {
  const runs = vec(uniforms, 'u_dashRuns');
  const counts = vec(uniforms, 'u_dashCount');
  const perKind = runs.length / Math.max(1, counts.length);
  const count = counts[kind] ?? 0;
  if (count <= 0) return 0;
  const pattern = runs.slice(kind * perKind, kind * perKind + count);
  const total = pattern.reduce((sum, run) => sum + run, 0);
  if (!(total > 0)) return 0;
  const phase = ((pattern[0] ?? 0) * 0.5 - length * 0.5) % total;
  return phase < 0 ? phase + total : phase;
}

/** One ribbon vertex as EDGE_VERT places it; null when the shader clips the ribbon away. */
interface RibbonVertex {
  px: [number, number];
  depth: number;
  along: number;
}

interface RibbonGeometry {
  pxA: [number, number];
  pxB: [number, number];
  tA: number;
  tB: number;
  viewA: [number, number, number];
  viewB: [number, number, number];
  worldA: [number, number, number];
  worldB: [number, number, number];
  erodedLength: number;
  phase: number;
}

/** EDGE_VERT up to the vertex's own end: both ends placed, clipped to the depth range, eroded. Null when clipped away. */
function ribbonGeometry(view: ShaderView, uniforms: Uniforms, a: number, b: number, kind: number, shrink: number): RibbonGeometry | null {
  if (kind === EDGE_CODE.aux && num(uniforms, 'u_showAux') < 0.5) return null;
  const worldA = view.fetch(a);
  const worldB = view.fetch(b);
  let viewA = view.toView(worldA);
  let viewB = view.toView(worldB);
  if (view.perspective) {
    let lo = 0;
    let hi = 1;
    const near = view.camDist * 0.1;
    const far = view.camDist + 2 * view.depthRange;
    for (let bound = 0; bound < 2; bound += 1) {
      const da = bound === 0 ? view.camDist - viewA[2] - near : far - view.camDist + viewA[2];
      const db = bound === 0 ? view.camDist - viewB[2] - near : far - view.camDist + viewB[2];
      if (da < 0 && db < 0) return null;
      if (da < 0) lo = Math.max(lo, da / (da - db));
      else if (db < 0) hi = Math.min(hi, da / (da - db));
    }
    const originalA = viewA;
    const mix = (t: number): [number, number, number] => [
      originalA[0] + (viewB[0] - originalA[0]) * t,
      originalA[1] + (viewB[1] - originalA[1]) * t,
      originalA[2] + (viewB[2] - originalA[2]) * t,
    ];
    viewA = mix(lo);
    viewB = mix(hi);
  }
  const pxA = view.toPx(viewA);
  const pxB = view.toPx(viewB);
  const length = Math.hypot(pxB[0] - pxA[0], pxB[1] - pxA[1]);
  const erode = num(uniforms, 'u_erodePx');
  let tA = 0;
  let tB = 1;
  if (erode > 0 && (shrink & 3) !== 0 && length > 0) {
    if (erode >= length * 0.5) {
      tA = 0.5;
      tB = 0.5;
    } else {
      const t = erode / length;
      if (shrink & 1) tA = t;
      if (shrink & 2) tB = 1 - t;
    }
  }
  const erodedLength = length * (tB - tA);
  return { pxA, pxB, tA, tB, viewA, viewB, worldA, worldB, erodedLength, phase: dashPhase(uniforms, kind, erodedLength) };
}

function ribbonVertex(view: ShaderView, uniforms: Uniforms, geometry: RibbonGeometry, kind: number, atA: boolean, side: number): RibbonVertex {
  const { pxA, pxB, tA, tB, viewA, viewB, erodedLength, phase } = geometry;
  const dx = pxB[0] - pxA[0];
  const dy = pxB[1] - pxA[1];
  const length = Math.hypot(dx, dy);
  const t = atA ? tA : tB;
  const half = vec(uniforms, 'u_halfWidthPx')[kind] ?? 0;
  const perp: [number, number] = length > 0.0001 ? [-dy / length, dx / length] : [0, 0];
  return {
    px: [pxA[0] + dx * t + perp[0] * half * side, pxA[1] + dy * t + perp[1] * half * side],
    depth: view.toNdcDepth(viewA[2]) + (view.toNdcDepth(viewB[2]) - view.toNdcDepth(viewA[2])) * t - num(uniforms, 'u_depthBias'),
    along: (atA ? 0 : erodedLength) + phase,
  };
}

/** Where the last frame starts: its clear of the depth buffer. */
function frameStart(commands: readonly RecordedCommand[]): number {
  let start = 0;
  commands.forEach((command, index) => {
    if (command.kind === 'clear' && command.depth) start = index;
  });
  return start;
}

/** Refuses draws made with a program this replay does not read. */
function assertModeled(commands: readonly RecordedCommand[]): void {
  const refusals = new Set<string>();
  for (const command of commands) {
    if (command.kind === 'clear') continue;
    const refusal = refusalOf(command.program);
    if (refusal) refusals.add(refusal);
  }
  if (refusals.size > 0) throw new UnmodeledShaderError([...refusals].join('; '));
}

/**
 * Whether the recorded frame's draws tested depth in perspective, as the
 * renderer they were drawn by set `u_perspectiveDepth`: what a model of the
 * frame that rasterises it by other means reads its depth mode from, rather
 * than holding a copy. Refuses as {@link replayFrame} does.
 */
export function recordedPerspectiveDepth(recording: Recording): boolean {
  const frame = recording.commands.slice(frameStart(recording.commands));
  assertModeled(frame);
  return frame.some((command) => command.kind !== 'clear' && num(command.uniforms, 'u_perspectiveDepth') > 0.5);
}

/** The mesh renderer's `toNdcDepth`: view depth to NDC z, linear or in perspective. */
export function ndcDepth(depth: number, camera: { camDist: number; depthRange: number }, perspective: boolean): number {
  if (perspective) {
    const near = camera.camDist * 0.1;
    const far = camera.camDist + 2 * camera.depthRange;
    return (far + near) / (far - near) - (2 * far * near) / ((far - near) * Math.max(camera.camDist - depth, 0.001));
  }
  return Math.max(-1, Math.min(1, -depth / camera.depthRange));
}

/**
 * The recorded frame rasterised: the last clear and every draw after it, in
 * order, into the paper-on-top and ink buffers, with one depth buffer. An
 * opaque face covers the ink under it; a blended one (a translucent style, an
 * undetermined cell) covers neither paper nor ink.
 *
 * Throws {@link UnmodeledShaderError} when any of those draws used a program
 * this replay does not read ({@link MODELED_PROGRAMS}).
 */
export function replayFrame(recording: Recording, options: ReplayOptions): ReplayedFrame {
  const commands = recording.commands;
  const start = frameStart(commands);
  assertModeled(commands.slice(start));
  const firstDraw = commands.slice(start).find((command) => command.kind !== 'clear') as Exclude<RecordedCommand, { kind: 'clear' }> | undefined;
  const width = Math.max(1, Math.round(firstDraw?.state.viewport[2] ?? 1));
  const height = Math.max(1, Math.round(firstDraw?.state.viewport[3] ?? 1));
  const face = new Int32Array(width * height).fill(-1);
  const side = new Int8Array(width * height);
  const ink = new Int32Array(width * height).fill(-1);
  const depth = new Float32Array(width * height).fill(1);
  const lines: ReplayedLine[] = [];
  const lineIndex = new Map<string, number>();
  const seen = { perspective: new Set<boolean>(), creaseBias: new Set<number>(), creaseWritesDepth: new Set<boolean>() };
  // Frame px, y down, from px about the centre, y up.
  const toFrame = (px: readonly [number, number]): [number, number] => [width / 2 + px[0], height / 2 - px[1]];

  for (const command of commands.slice(start)) {
    if (command.kind === 'clear') {
      if (command.depth) depth.fill(1);
      if (command.color) {
        face.fill(-1);
        side.fill(0);
        ink.fill(-1);
      }
      continue;
    }
    const view = new ShaderView(command, options.positions);
    const { state } = command;
    seen.perspective.add(view.perspective);
    const test = (at: number, z: number): boolean => {
      if (z < -1 || z > 1) return false;
      if (state.depthTest && !passesDepth(state.depthFunc, z, depth[at]!)) return false;
      if (state.depthTest && state.depthMask) depth[at] = z;
      return true;
    };

    if (command.kind === 'faces') {
      const { indices } = command;
      const end = Math.min(indices.length, command.first + command.count);
      for (let i = command.first; i + 2 < end; i += 3) {
        const corners = [indices[i]!, indices[i + 1]!, indices[i + 2]!].map((vertex) => {
          const viewed = view.toView(view.node(vertex));
          const [x, y] = toFrame(view.toPx(viewed));
          return [x, y, view.toNdcDepth(viewed[2]), 0] as const;
        }) as [Fragmentable, Fragmentable, Fragmentable];
        // `gl_FrontFacing`: counter-clockwise in window space, whose y is up.
        const [[ax, ay], [bx, by], [cx, cy]] = corners;
        const front = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0;
        const paper = options.faceOfTriangle(i / 3);
        rasterise(width, height, corners, (at, z) => {
          if (!test(at, z)) return;
          if (!state.colorMask || state.blend) return;
          face[at] = paper;
          side[at] = front ? 1 : -1;
          ink[at] = -1;
        });
      }
      continue;
    }

    seen.creaseBias.add(num(command.uniforms, 'u_depthBias'));
    seen.creaseWritesDepth.add(state.depthMask);
    const { vertices, layout } = command;
    const attribute = (vertex: number, name: EdgeAttribute) =>
      vertices[vertex * layout[name].stride + layout[name].offset] ?? 0;
    const geometries = new Map<string, RibbonGeometry | null>();
    const dashes = new Map<number, (alongPx: number) => boolean>();
    const dashOf = (kind: number) => {
      let dash = dashes.get(kind);
      if (!dash) dashes.set(kind, (dash = dashTest(command.uniforms, kind)));
      return dash;
    };
    for (let v = command.first; v + 2 < command.first + command.count; v += 3) {
      const a = Math.round(attribute(v, 'a_a'));
      const b = Math.round(attribute(v, 'a_b'));
      const kind = Math.round(attribute(v, 'a_assignment'));
      const shrink = Math.round(attribute(v, 'a_shrink'));
      const key = `${a}:${b}:${kind}:${shrink}`;
      let geometry = geometries.get(key);
      if (geometry === undefined) {
        geometry = ribbonGeometry(view, command.uniforms, a, b, kind, shrink);
        geometries.set(key, geometry);
      }
      if (!geometry) continue;
      const lineKey = `${a}:${b}:${kind}`;
      let line = lineIndex.get(lineKey);
      if (line === undefined) {
        const { pxA, pxB, tA, tB, worldA, worldB, phase } = geometry;
        const dx = pxB[0] - pxA[0];
        const dy = pxB[1] - pxA[1];
        const dash = dashOf(kind);
        line = lines.length;
        lines.push({
          a,
          b,
          code: kind,
          worldA,
          worldB,
          from: toFrame([pxA[0] + dx * tA, pxA[1] + dy * tA]),
          to: toFrame([pxA[0] + dx * tB, pxA[1] + dy * tB]),
          halfWidthPx: vec(command.uniforms, 'u_halfWidthPx')[kind] ?? 0,
          dashOn: (alongPx) => dash(alongPx + phase),
        });
        lineIndex.set(lineKey, line);
      }
      const corners = [v, v + 1, v + 2].map((vertex) => {
        const atA = Math.round(attribute(vertex, 'a_this')) === a;
        const placed = ribbonVertex(view, command.uniforms, geometry!, kind, atA, attribute(vertex, 'a_side'));
        const [x, y] = toFrame(placed.px);
        return [x, y, placed.depth, placed.along] as const;
      }) as [Fragmentable, Fragmentable, Fragmentable];
      const dash = dashOf(kind);
      const id = line;
      rasterise(width, height, corners, (at, z, along) => {
        if (!dash(along)) return;
        if (!test(at, z)) return;
        if (state.colorMask) ink[at] = id;
      });
    }
  }
  return {
    width,
    height,
    face,
    side,
    ink,
    lines,
    depth: {
      perspective: [...seen.perspective],
      creaseBias: [...seen.creaseBias],
      creaseWritesDepth: [...seen.creaseWritesDepth],
    },
  };
}

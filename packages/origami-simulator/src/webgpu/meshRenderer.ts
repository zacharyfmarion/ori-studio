/// <reference types="@webgpu/types" />
// Draws the folded mesh on WebGPU, straight from a position buffer: the WebGPU
// counterpart of webgl/meshRenderer.ts, which is the reference for everything
// here. The pure parts — ribbon geometry, crease pens, dash packing, erode —
// are that module's own exports, so the two renderers cannot disagree about
// what to draw; only the shaders and the pipeline state are restated.
//
// Differences from the GL renderer, all to keep the picture the same:
//
//   - Depth: GL's NDC z runs -1..1, WebGPU's 0..1, so depth is remapped.
//   - Viewport: WebGPU's origin is top-left. The frame is drawn at the bottom
//     of the target, where GL draws it, so a caller cropping a bitmap from the
//     bottom (the session's renderGpu) crops the same rect from either.
//   - Blend state is fixed per pipeline, so each GL state change is a pipeline.
//   - Antialiasing: GL asks for a multisampled default framebuffer; here a 4x
//     colour target is resolved into the output.
import type { CameraUniforms, Mat3 } from '../webgl/camera.js';
import {
  buildEdgeQuads,
  creaseFrameScale,
  creaseWidthsPx,
  DEFAULT_CREASE_DEPTH_BIAS,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_MIX,
  EDGE_STRIDE,
  erodePx,
  MAX_DASH_RUNS,
  DASH_KINDS,
  packCreaseDash,
  rasterCreaseInk,
  type MeshDrawOptions,
  type MeshRendererOptions,
  type MeshTopology,
  type RenderSettings,
} from '../webgl/meshRenderer.js';
import { EDGE_CODE } from '../edgeCodes.js';
import { SHADE_AMBIENT, SHADE_DIFFUSE, SHADE_FACING, SHADE_MAX, SHADE_MIN } from '../shading.js';
import type { GpuCore } from './gpuCore.js';

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

/** Where a frame is drawn: a texture view and its size. */
export interface WebgpuRenderTarget {
  view: GPUTextureView;
  width: number;
  height: number;
  format: GPUTextureFormat;
}

/** The buffers a frame reads its vertices from, as the solver currently holds them. */
export interface WebgpuMeshSource {
  /** Each node's displacement from the flat sheet, RGBA. */
  positions(): GPUBuffer;
  /** Each node's velocity, RGBA, strain in alpha; null draws zero strain. */
  velocities(): GPUBuffer | null;
}

/** A number as a WGSL float literal. */
function wgslFloat(value: number): string {
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

const VIEW = /* wgsl */ `
struct View {
  center   : vec4<f32>,   // xyz, scale
  col0     : vec4<f32>,
  col1     : vec4<f32>,
  col2     : vec4<f32>,
  viewport : vec4<f32>,   // width, height, depthRange, camDist
};
@group(0) @binding(0) var<uniform>       view           : View;
@group(0) @binding(1) var<storage, read> lastPosition   : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> originalPosition : array<vec4<f32>>;

fn fetchPosition(i : u32) -> vec3<f32> { return lastPosition[i].xyz + originalPosition[i].xyz; }

fn toView(world : vec3<f32>) -> vec3<f32> {
  return mat3x3<f32>(view.col0.xyz, view.col1.xyz, view.col2.xyz) * (world - view.center.xyz);
}

// One-point perspective, as VIEW_GLSL in webgl/meshRenderer.ts.
fn toNdc(v : vec3<f32>) -> vec2<f32> {
  let camDist = view.viewport.w;
  let persp = camDist / max(camDist - v.z, 0.001);
  return vec2<f32>(
    v.x * persp * view.center.w / (view.viewport.x * 0.5),
    v.y * persp * view.center.w / (view.viewport.y * 0.5),
  );
}

// GL's clamp(-depth/range, -1, 1), moved into WebGPU's 0..1.
fn toNdcDepth(depth : f32) -> f32 {
  return clamp(-depth / view.viewport.z, -1.0, 1.0) * 0.5 + 0.5;
}
`;

export const FACE_SHADER = /* wgsl */ `
${VIEW}
struct Face {
  front : vec4<f32>,   // rgb, lighting
  back  : vec4<f32>,   // rgb, alpha
  light : vec4<f32>,   // xyz, strainMode
  tint  : vec4<f32>,   // rgb, tintMix
  misc  : vec4<f32>,   // strainClip
};
@group(0) @binding(3) var<storage, read> lastVelocity : array<vec4<f32>>;
@group(0) @binding(4) var<uniform>       face         : Face;

struct Varyings {
  @builtin(position) position : vec4<f32>,
  @location(0) viewPos : vec3<f32>,
  @location(1) strain : f32,
};

@vertex
fn vs(@builtin(vertex_index) index : u32) -> Varyings {
  var out : Varyings;
  // velocityCalc stores this node's mean axial strain in the velocity alpha.
  out.strain = lastVelocity[index].w;
  let v = toView(fetchPosition(index));
  out.viewPos = v;
  out.position = vec4<f32>(toNdc(v), toNdcDepth(v.z), 1.0);
  return out;
}

// Upstream colours strain with THREE.Color.setHSL(hue, 1, 0.5).
fn hueToRgb(h : f32) -> vec3<f32> {
  let r = abs(h * 6.0 - 3.0) - 1.0;
  let g = 2.0 - abs(h * 6.0 - 2.0);
  let b = 2.0 - abs(h * 6.0 - 4.0);
  return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
}

// shading.ts's shadeFor, the band every renderer shades paper with.
fn shadeFor(normal : vec3<f32>, lightDir : vec3<f32>) -> f32 {
  let n = select(normal, -normal, normal.z < 0.0);
  let diffuse = max(0.0, dot(n, normalize(lightDir)));
  return clamp(${wgslFloat(SHADE_AMBIENT)} + diffuse * ${wgslFloat(SHADE_DIFFUSE)} + n.z * ${wgslFloat(SHADE_FACING)}, ${wgslFloat(SHADE_MIN)}, ${wgslFloat(SHADE_MAX)});
}

@fragment
fn fs(in : Varyings, @builtin(front_facing) frontFacing : bool) -> @location(0) vec4<f32> {
  let normal = normalize(cross(dpdx(in.viewPos), dpdy(in.viewPos)));
  let base = select(face.back.rgb, face.front.rgb, frontFacing);
  var color : vec3<f32>;
  if (face.light.w > 0.5) {
    let clip = face.misc.x;
    let e = min(in.strain * 100.0, clip);
    color = hueToRgb(clamp((1.0 - e / max(clip, 0.0001)) * 0.7, 0.0, 1.0));
  } else {
    var shade = 1.0;
    if (face.front.w > 0.5) { shade = shadeFor(normal, face.light.xyz); }
    color = base * shade;
  }
  return vec4<f32>(mix(color, face.tint.rgb, face.tint.w), face.back.w);
}
`;

export const EDGE_SHADER = /* wgsl */ `
${VIEW}
struct Edge {
  mountain    : vec4<f32>,
  valley      : vec4<f32>,
  border      : vec4<f32>,
  aux         : vec4<f32>,   // rgb, showAux
  halfWidth   : vec4<f32>,   // by assignment code
  creaseAlpha : vec4<f32>,   // by assignment code
  misc        : vec4<f32>,   // erodePx, depthBias
  dashCount   : vec4<f32>,   // by assignment code
  dashRuns    : array<vec4<f32>, ${(DASH_KINDS * MAX_DASH_RUNS) / 4}>,
};
@group(0) @binding(3) var<uniform> edge : Edge;

struct EdgeIn {
  @location(0) here : f32,
  @location(1) a : f32,
  @location(2) b : f32,
  @location(3) side : f32,
  @location(4) assignment : f32,
  @location(5) shrink : f32,
};

struct Varyings {
  @builtin(position) position : vec4<f32>,
  @location(0) @interpolate(flat) assignment : u32,
  @location(1) alongPx : f32,
};

fn run(kind : u32, i : u32) -> f32 {
  let index = kind * ${MAX_DASH_RUNS}u + i;
  return edge.dashRuns[index / 4u][index % 4u];
}

fn dashTotal(kind : u32) -> f32 {
  let count = u32(edge.dashCount[kind]);
  var total = 0.0;
  for (var i = 0u; i < count; i = i + 1u) { total = total + run(kind, i); }
  return total;
}

// EDGE_VERT's dashPhase: the pattern centred on the edge, as the vector painter centres it.
fn dashPhase(kind : u32, len : f32) -> f32 {
  if (u32(edge.dashCount[kind]) == 0u) { return 0.0; }
  let total = dashTotal(kind);
  if (total <= 0.0) { return 0.0; }
  let x = run(kind, 0u) * 0.5 - len * 0.5;
  return x - total * floor(x / total);
}

fn projectNdc(i : u32) -> vec2<f32> { return toNdc(toView(fetchPosition(i))); }
fn projectDepth(i : u32) -> f32 { return toNdcDepth(toView(fetchPosition(i)).z); }

@vertex
fn vs(input : EdgeIn) -> Varyings {
  var out : Varyings;
  let kind = u32(input.assignment + 0.5);
  out.assignment = kind;
  // A hidden aux crease: every vertex behind the far plane, clipped before it costs a fragment.
  if (kind == ${EDGE_CODE.aux}u && edge.aux.w < 0.5) {
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.alongPx = 0.0;
    return out;
  }
  let indexA = u32(input.a + 0.5);
  let indexB = u32(input.b + 0.5);
  let atA = u32(input.here + 0.5) == indexA;
  let halfViewport = view.viewport.xy * 0.5;
  let pxA = projectNdc(indexA) * halfViewport;
  let pxB = projectNdc(indexB) * halfViewport;
  let dirPx = pxB - pxA;
  let len = length(dirPx);
  // Erode, as EDGE_VERT and the vector painter's erodeSegment.
  let shrink = u32(input.shrink + 0.5);
  let shrinkA = (shrink & 1u) != 0u;
  let shrinkB = (shrink & 2u) != 0u;
  var tA = 0.0;
  var tB = 1.0;
  let erode = edge.misc.x;
  if (erode > 0.0 && (shrinkA || shrinkB) && len > 0.0) {
    if (erode >= len * 0.5) {
      tA = 0.5;
      tB = 0.5;
    } else {
      let t = erode / len;
      if (shrinkA) { tA = t; }
      if (shrinkB) { tB = 1.0 - t; }
    }
  }
  let t = select(tB, tA, atA);
  let pxHere = mix(pxA, pxB, t);
  let erodedLen = len * (tB - tA);
  out.alongPx = select(erodedLen, 0.0, atA) + dashPhase(kind, erodedLen);
  var perpPx = vec2<f32>(0.0);
  if (len > 0.0001) { perpPx = vec2<f32>(-dirPx.y, dirPx.x) / len; }
  let offsetPx = perpPx * edge.halfWidth[kind] * input.side;
  // Biased toward the viewer, in GL's units: the bias halves with the depth range.
  let depth = mix(projectDepth(indexA), projectDepth(indexB), t) - edge.misc.y * 0.5;
  out.position = vec4<f32>((pxHere + offsetPx) / halfViewport, depth, 1.0);
  return out;
}

fn dashOn(kind : u32, alongPx : f32) -> bool {
  let count = u32(edge.dashCount[kind]);
  if (count == 0u) { return true; }
  let total = dashTotal(kind);
  if (total <= 0.0) { return true; }
  let pos = alongPx - total * floor(alongPx / total);
  var acc = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    acc = acc + run(kind, i);
    // Even runs are ink, odd runs are gaps, as setLineDash and stroke-dasharray.
    if (pos < acc) { return i % 2u == 0u; }
  }
  return true;
}

@fragment
fn fs(in : Varyings) -> @location(0) vec4<f32> {
  var color = edge.border.rgb;
  if (in.assignment == 1u) { color = edge.mountain.rgb; }
  else if (in.assignment == 2u) { color = edge.valley.rgb; }
  else if (in.assignment == ${EDGE_CODE.aux}u) { color = edge.aux.rgb; }
  if (!dashOn(in.assignment, in.alongPx)) { discard; }
  return vec4<f32>(color, edge.creaseAlpha[in.assignment]);
}
`;

const OVER: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
  // Coverage accumulates without being scaled down by what is drawn over it,
  // as the GL crease pass's blendFuncSeparate.
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

type FacePipeline = 'opaque' | 'translucent';
type EdgePipeline = 'opaque' | 'opaqueNoDepth' | 'faded';

/** The rows of a row-major Mat3 as the columns WGSL's `mat3x3 * v` needs. */
function viewColumns(m: Mat3): number[] {
  const out: number[] = [];
  for (let column = 0; column < 3; column += 1) out.push(m[column]!, m[3 + column]!, m[6 + column]!, 0);
  return out;
}

export class WebgpuMeshRenderer {
  private readonly device: GPUDevice;
  private readonly faceIndexBuffer: GPUBuffer;
  private readonly edgeBuffer: GPUBuffer;
  private readonly originalBuffer: GPUBuffer;
  private readonly zeroVelocity: GPUBuffer;
  private readonly viewUniform: GPUBuffer;
  private readonly faceUniform: GPUBuffer;
  private readonly highlightUniform: GPUBuffer;
  private readonly edgeUniform: GPUBuffer;
  private readonly faceCount: number;
  private readonly faceIndices: Uint32Array;
  private readonly edgeVertexCount: number;
  private readonly edgeVertexStart: Uint32Array;
  private readonly sheet: number;
  private readonly faceModule: GPUShaderModule;
  private readonly edgeModule: GPUShaderModule;
  private readonly facePipelines = new Map<string, GPURenderPipeline>();
  private readonly edgePipelines = new Map<string, GPURenderPipeline>();
  private highlightBuffer: GPUBuffer | null = null;
  private highlightCount = 0;
  private multisample: GPUTexture | null = null;
  private depth: GPUTexture | null = null;

  /**
   * Compile and check the renderer's shaders on `core`, so a renderer built
   * on it afterwards needs no wait and a WGSL error is a throw, not a warning.
   */
  static async validateShaders(core: GpuCore): Promise<void> {
    await core.validate(FACE_SHADER, 'faces');
    await core.validate(EDGE_SHADER, 'creases');
  }

  /**
   * `originalPositions` is the flat sheet as the position buffer's companion,
   * RGBA per node (webgl/packing.ts's originalPosition).
   */
  constructor(
    private readonly core: GpuCore,
    topology: MeshTopology,
    originalPositions: Float32Array,
    private readonly source: WebgpuMeshSource,
    options: MeshRendererOptions = {}
  ) {
    const device = core.device;
    this.device = device;
    this.sheet = Math.max(0, options.sheet ?? 0);
    this.faceCount = topology.faceIndices.length;
    this.faceIndices = topology.faceIndices;
    this.faceIndexBuffer = indexBuffer(device, topology.faceIndices, 'faces');
    const { interleaved, vertexStart } = buildEdgeQuads(topology);
    this.edgeVertexCount = interleaved.length / EDGE_STRIDE;
    this.edgeVertexStart = vertexStart;
    this.edgeBuffer = device.createBuffer({
      label: 'crease ribbons',
      size: Math.max(16, interleaved.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    if (interleaved.byteLength > 0) device.queue.writeBuffer(this.edgeBuffer, 0, interleaved as Float32Array<ArrayBuffer>);
    this.originalBuffer = core.storageBuffer(originalPositions, 'originalPosition');
    this.zeroVelocity = core.storageBuffer(new Float32Array(originalPositions.length), 'no velocity');
    const uniform = (label: string, size: number) =>
      device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.viewUniform = uniform('view', 5 * 16);
    this.faceUniform = uniform('face', 5 * 16);
    this.highlightUniform = uniform('highlight', 5 * 16);
    this.edgeUniform = uniform('edge', (8 + (DASH_KINDS * MAX_DASH_RUNS) / 4) * 16);
    // From the core's cache, so a shader validated up front is not compiled twice.
    this.faceModule = core.module(FACE_SHADER, 'faces');
    this.edgeModule = core.module(EDGE_SHADER, 'creases');
  }

  /** As MeshRenderer.setHighlightTriangles: the triangles a highlighted frame redraws tinted. */
  setHighlightTriangles(triangles: ArrayLike<number> | null): void {
    this.highlightBuffer?.destroy();
    this.highlightBuffer = null;
    this.highlightCount = 0;
    const triangleCount = this.faceCount / 3;
    const subset: number[] = [];
    for (let i = 0; i < (triangles?.length ?? 0); i += 1) {
      const triangle = triangles![i]!;
      if (!Number.isInteger(triangle) || triangle < 0 || triangle >= triangleCount) continue;
      subset.push(this.faceIndices[triangle * 3]!, this.faceIndices[triangle * 3 + 1]!, this.faceIndices[triangle * 3 + 2]!);
    }
    if (subset.length === 0) return;
    this.highlightBuffer = indexBuffer(this.device, Uint32Array.from(subset), 'highlight');
    this.highlightCount = subset.length;
  }

  /**
   * Draw a frame into `target`, as MeshRenderer.render draws into a
   * framebuffer: the same settings, the same options, the same picture.
   */
  render(camera: CameraUniforms, settings: RenderSettings, target: WebgpuRenderTarget, options: MeshDrawOptions = {}): void {
    this.core.assertLive();
    const device = this.device;
    this.ensureAttachments(target);
    device.queue.writeBuffer(
      this.viewUniform,
      0,
      new Float32Array([
        ...camera.center,
        camera.scale,
        ...viewColumns(camera.rotation),
        camera.width,
        camera.height,
        camera.depthRange,
        camera.camDist,
      ])
    );

    const clear = options.clear ?? true;
    const backgroundAlpha = settings.backgroundAlpha ?? 1;
    // As the GL renderer: a transparent clear is transparent black, so a
    // compositor reading it as premultiplied adds nothing.
    const background = backgroundAlpha > 0 ? settings.background : [0, 0, 0];
    const encoder = device.createCommandEncoder({ label: 'mesh frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.multisample!.createView(),
          resolveTarget: target.view,
          loadOp: clear ? 'clear' : 'load',
          storeOp: 'store',
          clearValue: { r: background[0]!, g: background[1]!, b: background[2]!, a: backgroundAlpha },
        },
      ],
      depthStencilAttachment: {
        view: this.depth!.createView(),
        depthLoadOp: clear ? 'clear' : 'load',
        depthStoreOp: 'store',
        depthClearValue: 1,
      },
    });
    // At the bottom of the target, where GL's (0, 0) viewport puts the frame.
    pass.setViewport(0, target.height - camera.height, camera.width, camera.height, 0, 1);
    pass.setScissorRect(0, Math.max(0, target.height - camera.height), Math.min(camera.width, target.width), Math.min(camera.height, target.height));

    const positions = this.source.positions();
    const velocities = this.source.velocities() ?? this.zeroVelocity;
    if (settings.showFaces) {
      const translucent = settings.faceAlpha < 1;
      this.writeFace(this.faceUniform, settings, 0, [0, 0, 0]);
      const pipeline = this.facePipeline(translucent ? 'translucent' : 'opaque', target.format);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.faceGroup(pipeline, positions, velocities, this.faceUniform));
      const first = clampRange(options.faceRange?.start ?? 0, this.faceCount);
      const count = clampRange(options.faceRange?.count ?? this.faceCount - first, this.faceCount - first);
      pass.setIndexBuffer(this.faceIndexBuffer, 'uint32');
      if (count > 0) pass.drawIndexed(count, 1, first);
      // The same triangles through the same shader, at the same depth: a hidden
      // highlighted face stays hidden. Before the creases, which draw over the tint.
      if (options.highlight && this.highlightBuffer && this.highlightCount > 0) {
        this.writeFace(
          this.highlightUniform,
          settings,
          settings.highlightMix ?? DEFAULT_HIGHLIGHT_MIX,
          settings.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR
        );
        pass.setBindGroup(0, this.faceGroup(pipeline, positions, velocities, this.highlightUniform));
        pass.setIndexBuffer(this.highlightBuffer, 'uint32');
        pass.drawIndexed(this.highlightCount);
      }
    }

    if (settings.showEdges && this.edgeVertexCount > 0) {
      const inks = creaseWidthsPx(settings).map((widthPx) => rasterCreaseInk(widthPx, settings, camera.width, camera.height));
      const showAux = settings.showAux ?? false;
      const faded = inks.some((ink, code) => ink.alpha < 1 && (showAux || code !== EDGE_CODE.aux));
      const kind: EdgePipeline = faded ? 'faded' : (settings.creaseWritesDepth ?? true) ? 'opaque' : 'opaqueNoDepth';
      const { runs, counts } = packCreaseDash(settings.creaseDash);
      const scale = creaseFrameScale(settings, camera.width, camera.height);
      const aux = settings.auxColor ?? settings.borderColor;
      device.queue.writeBuffer(
        this.edgeUniform,
        0,
        new Float32Array([
          ...settings.mountainColor,
          0,
          ...settings.valleyColor,
          0,
          ...settings.borderColor,
          0,
          ...aux,
          showAux ? 1 : 0,
          ...inks.map((ink) => ink.widthPx * 0.5),
          ...inks.map((ink) => ink.alpha),
          erodePx(settings, this.sheet, camera),
          settings.creaseDepthBias ?? DEFAULT_CREASE_DEPTH_BIAS,
          0,
          0,
          ...Array.from(counts),
          ...Array.from(runs, (value) => value * scale),
        ])
      );
      const pipeline = this.edgePipeline(kind, target.format);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.edgeGroup(pipeline, positions));
      pass.setVertexBuffer(0, this.edgeBuffer);
      const edges = this.edgeVertexStart.length - 1;
      const firstEdge = clampRange(options.edgeRange?.start ?? 0, edges);
      const edgeCount = clampRange(options.edgeRange?.count ?? edges - firstEdge, edges - firstEdge);
      const firstVertex = this.edgeVertexStart[firstEdge]!;
      const vertexCount = this.edgeVertexStart[firstEdge + edgeCount]! - firstVertex;
      if (vertexCount > 0) pass.draw(vertexCount, 1, firstVertex);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Render to an offscreen `width`×`height` RGBA8 texture and read it back:
   * MeshRenderer's renderToImage. Rows run top to bottom.
   */
  async renderToPixels(
    camera: CameraUniforms,
    settings: RenderSettings,
    options: MeshDrawOptions = {}
  ): Promise<Uint8Array> {
    const { width, height } = camera;
    const texture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.render(camera, settings, { view: texture.createView(), width, height, format: 'rgba8unorm' }, options);
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row += 1) out.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
    buffer.unmap();
    buffer.destroy();
    texture.destroy();
    return out;
  }

  dispose(): void {
    for (const buffer of [this.faceIndexBuffer, this.edgeBuffer, this.viewUniform, this.faceUniform, this.highlightUniform, this.edgeUniform]) {
      buffer.destroy();
    }
    this.core.release(this.originalBuffer);
    this.core.release(this.zeroVelocity);
    this.highlightBuffer?.destroy();
    this.multisample?.destroy();
    this.depth?.destroy();
  }

  private writeFace(uniform: GPUBuffer, settings: RenderSettings, tintMix: number, tint: readonly [number, number, number]): void {
    this.device.queue.writeBuffer(
      uniform,
      0,
      new Float32Array([
        ...settings.frontColor,
        settings.lighting ? 1 : 0,
        ...settings.backColor,
        settings.faceAlpha,
        ...settings.lightDir,
        settings.colorMode === 'strain' ? 1 : 0,
        ...tint,
        tintMix,
        settings.strainClip ?? 5,
        0,
        0,
        0,
      ])
    );
  }

  /** Multisampled colour and depth sized to the target, kept until it changes size or format. */
  private ensureAttachments(target: WebgpuRenderTarget): void {
    const ms = this.multisample;
    if (ms && ms.width === target.width && ms.height === target.height && ms.format === target.format) return;
    ms?.destroy();
    this.depth?.destroy();
    const size = { width: target.width, height: target.height };
    this.multisample = this.device.createTexture({
      size,
      sampleCount: SAMPLE_COUNT,
      format: target.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depth = this.device.createTexture({
      size,
      sampleCount: SAMPLE_COUNT,
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private facePipeline(kind: FacePipeline, format: GPUTextureFormat): GPURenderPipeline {
    const key = `${kind}:${format}`;
    let pipeline = this.facePipelines.get(key);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        label: `faces ${key}`,
        layout: 'auto',
        vertex: { module: this.faceModule, entryPoint: 'vs' },
        fragment: {
          module: this.faceModule,
          entryPoint: 'fs',
          targets: [kind === 'translucent' ? { format, blend: OVER } : { format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        // x-ray: translucent faces do not write depth.
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: kind === 'opaque', depthCompare: 'less-equal' },
        multisample: { count: SAMPLE_COUNT },
      });
      this.facePipelines.set(key, pipeline);
    }
    return pipeline;
  }

  private edgePipeline(kind: EdgePipeline, format: GPUTextureFormat): GPURenderPipeline {
    const key = `${kind}:${format}`;
    let pipeline = this.edgePipelines.get(key);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        label: `creases ${key}`,
        layout: 'auto',
        vertex: {
          module: this.edgeModule,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: EDGE_STRIDE * 4,
              attributes: Array.from({ length: EDGE_STRIDE }, (_, location) => ({
                shaderLocation: location,
                offset: location * 4,
                format: 'float32' as GPUVertexFormat,
              })),
            },
          ],
        },
        fragment: { module: this.edgeModule, entryPoint: 'fs', targets: [kind === 'faded' ? { format, blend: OVER } : { format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: kind === 'opaque', depthCompare: 'less-equal' },
        multisample: { count: SAMPLE_COUNT },
      });
      this.edgePipelines.set(key, pipeline);
    }
    return pipeline;
  }

  private faceGroup(pipeline: GPURenderPipeline, positions: GPUBuffer, velocities: GPUBuffer, uniform: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [this.viewUniform, positions, this.originalBuffer, velocities, uniform].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
  }

  private edgeGroup(pipeline: GPURenderPipeline, positions: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [this.viewUniform, positions, this.originalBuffer, this.edgeUniform].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
  }
}

function indexBuffer(device: GPUDevice, indices: Uint32Array, label: string): GPUBuffer {
  // Index data must be a multiple of 4 bytes, and a zero-sized buffer cannot be bound.
  const buffer = device.createBuffer({ label, size: Math.max(16, indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  if (indices.byteLength > 0) device.queue.writeBuffer(buffer, 0, indices as Uint32Array<ArrayBuffer>);
  return buffer;
}

/** Clamp a face-index count or offset into `[0, limit]`, as MeshRenderer does. */
function clampRange(value: number, limit: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), Math.max(0, limit));
}

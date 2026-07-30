// Draws the folded mesh straight from the solver's position texture.
//
// This is the zero-readback render path: `drawElements` with the face index
// buffer, and the vertex shader `texelFetch`es the vertex position from the
// solver's `u_lastPosition` (+ `u_originalPosition`) using `gl_VertexID`, which
// under WebGL2 `drawElements` is the vertex index from the element buffer. So
// positions never leave the GPU -- no readback, no upload.
//
// The projection is the exact orbit projection the canvas-2D renderer used (see
// camera.ts), so the WebGL output matches what users already see. Faces are
// depth-tested (no painter's sort), two-tone via `gl_FrontFacing`, flat-lit from
// the screen-space derivative of view position. Edges are a `LINES` pass.
import type { GlCore } from './glCore.js';
import type { CameraUniforms } from './camera.js';

export interface MeshTopology {
  /** Triangle vertex indices, 3 per face. */
  faceIndices: Uint32Array;
  /** Edge vertex indices, 2 per edge. */
  edgeIndices: Uint32Array;
  /**
   * Per-edge fold assignment as a code: 0=B(order), 1=M, 2=V, 3=F(acet),
   * matching EDGE_ASSIGNMENT_CODES. Drives crease colour so mountains and
   * valleys read distinctly.
   */
  edgeAssignments: Uint8Array;
  /** Square texture edge length the solver packs vertices into. */
  textureDim: number;
}

export interface RenderSettings {
  frontColor: [number, number, number];
  backColor: [number, number, number];
  /** Crease colours by assignment; mountain/valley must differ to be legible. */
  mountainColor: [number, number, number];
  valleyColor: [number, number, number];
  borderColor: [number, number, number];
  lightDir: [number, number, number];
  background: [number, number, number];
  /**
   * Opacity of {@link background}. 1 fills the frame; 0 clears it to nothing, so
   * whatever sits behind the canvas shows through wherever the model does not
   * cover it — which is how an inline simulation window reads as sitting on the
   * crease pattern rather than over a hole punched in it. Defaults to opaque.
   */
  backgroundAlpha?: number;
  showFaces: boolean;
  showEdges: boolean;
  lighting: boolean;
  /** Crease line width in device pixels. */
  creaseWidthPx: number;
  /** 0..1; below 1 draws faces translucent with depth write off (x-ray). */
  faceAlpha: number;
  /**
   * `paper` shades the two-tone sheet; `strain` colours each vertex by how far
   * its edges are stretched, which is where a crease pattern is not physically
   * foldable. Defaults to `paper` when omitted.
   */
  colorMode?: 'paper' | 'strain';
  /**
   * Percent axial strain drawn fully red in `strain` mode. Upstream's
   * `strainClip`, default 5%.
   */
  strainClip?: number;
}

// Interleaved edge-vertex layout: [this, a, b, side, assignment].
const EDGE_STRIDE = 5;
const EDGE_ATTRS: ReadonlyArray<readonly [string, number]> = [
  ['a_this', 0],
  ['a_a', 1],
  ['a_b', 2],
  ['a_side', 3],
  ['a_assignment', 4],
];

/**
 * Expand each drawn crease into a 2-triangle screen-space ribbon. Only border,
 * mountain and valley edges are drawn (codes 0/1/2); facet edges from
 * triangulation and unassigned edges are skipped. Returns the interleaved
 * vertex buffer.
 */
function buildEdgeQuads(topology: MeshTopology): Float32Array {
  const edgeCount = topology.edgeAssignments.length;
  let drawn = 0;
  for (let e = 0; e < edgeCount; e += 1) {
    if (topology.edgeAssignments[e]! <= 2) drawn += 1;
  }

  const out = new Float32Array(drawn * 6 * EDGE_STRIDE);
  let v = 0;
  const emit = (thisIndex: number, a: number, b: number, side: number, assignment: number) => {
    out[v] = thisIndex;
    out[v + 1] = a;
    out[v + 2] = b;
    out[v + 3] = side;
    out[v + 4] = assignment;
    v += EDGE_STRIDE;
  };

  for (let e = 0; e < edgeCount; e += 1) {
    const assignment = topology.edgeAssignments[e]!;
    if (assignment > 2) continue;
    const a = topology.edgeIndices[e * 2]!;
    const b = topology.edgeIndices[e * 2 + 1]!;
    // Two triangles: (Aleft, Aright, Bleft) and (Aright, Bright, Bleft).
    emit(a, a, b, 1, assignment);
    emit(a, a, b, -1, assignment);
    emit(b, a, b, 1, assignment);
    emit(a, a, b, -1, assignment);
    emit(b, a, b, -1, assignment);
    emit(b, a, b, 1, assignment);
  }
  return out;
}

const FACE_VERT = `#version 300 es
precision highp float;
uniform sampler2D u_lastPosition;
uniform sampler2D u_originalPosition;
uniform sampler2D u_lastVelocity;
uniform int u_textureDim;
uniform vec3 u_center;
uniform vec2 u_yaw;   // cos, sin
uniform vec2 u_pitch; // cos, sin
uniform float u_scale;
uniform vec2 u_viewport;
uniform float u_depthRange;
uniform float u_camDist;
out vec3 v_view;
out float v_strain;

vec3 fetchPosition(int index){
  ivec2 texel = ivec2(index % u_textureDim, index / u_textureDim);
  return texelFetch(u_lastPosition, texel, 0).xyz + texelFetch(u_originalPosition, texel, 0).xyz;
}

void main(){
  ivec2 texel = ivec2(gl_VertexID % u_textureDim, gl_VertexID / u_textureDim);
  // velocityCalc stores this node's mean axial strain in the velocity alpha, the
  // same channel upstream reads back for its strain visualization.
  v_strain = texelFetch(u_lastVelocity, texel, 0).w;
  vec3 d = fetchPosition(gl_VertexID) - u_center;
  float yawX =  u_yaw.x*d.x + u_yaw.y*d.z;
  float yawZ = -u_yaw.y*d.x + u_yaw.x*d.z;
  float x = yawX;
  float y = u_pitch.x*yawZ - u_pitch.y*d.y;
  float depth = u_pitch.y*yawZ + u_pitch.x*d.y;
  v_view = vec3(x, y, depth);
  // One-point perspective: eye at +camDist along the view axis, so nearer points
  // (larger depth) magnify and farther ones shrink -> parallels converge.
  float persp = u_camDist / max(u_camDist - depth, 0.001);
  gl_Position = vec4(
    x*persp*u_scale/(u_viewport.x*0.5),
    y*persp*u_scale/(u_viewport.y*0.5),
    clamp(-depth/u_depthRange, -1.0, 1.0),
    1.0
  );
}`;

const FACE_FRAG = `#version 300 es
precision highp float;
in vec3 v_view;
in float v_strain;
uniform vec3 u_frontColor;
uniform vec3 u_backColor;
uniform vec3 u_lightDir;
uniform float u_lighting;
uniform float u_alpha;
uniform float u_strainMode;
uniform float u_strainClip;
out vec4 fragColor;

// Upstream colours strain with THREE.Color.setHSL(hue, 1, 0.5), so match that
// exactly rather than inventing a ramp.
vec3 hueToRgb(float h){
  float r = abs(h*6.0 - 3.0) - 1.0;
  float g = 2.0 - abs(h*6.0 - 2.0);
  float b = 2.0 - abs(h*6.0 - 4.0);
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

void main(){
  vec3 normal = normalize(cross(dFdx(v_view), dFdy(v_view)));
  vec3 base = gl_FrontFacing ? u_frontColor : u_backColor;
  if (u_strainMode > 0.5){
    // Percent strain, clipped, mapped hue 0.7 (blue, relaxed) -> 0 (red, at the
    // clip). Upstream: scaledVal = (1 - e/clip) * 0.7.
    float e = min(v_strain*100.0, u_strainClip);
    base = hueToRgb(clamp((1.0 - e/max(u_strainClip, 0.0001)) * 0.7, 0.0, 1.0));
    // Flat-shade strain: lighting would read as strain that is not there.
    fragColor = vec4(base, u_alpha);
    return;
  }
  float shade = 1.0;
  if (u_lighting > 0.5){
    vec3 n = normal.z < 0.0 ? -normal : normal;
    float diffuse = max(0.0, dot(n, normalize(u_lightDir)));
    shade = clamp(0.74 + diffuse*0.3 + n.z*0.04, 0.68, 1.08);
  }
  fragColor = vec4(base*shade, u_alpha);
}`;

// Creases are drawn as screen-space quads, not GL LINES: native line width is
// clamped to 1px on Metal/ANGLE, which makes creases nearly invisible on a busy
// model. Each edge becomes a camera-facing ribbon of constant pixel width. The
// vertex shader projects both endpoints, takes the screen-space perpendicular,
// and offsets this vertex by +/- half the width.
const EDGE_VERT = `#version 300 es
precision highp float;
in float a_this;       // node index to place this vertex at
in float a_a;          // edge endpoint A (for direction)
in float a_b;          // edge endpoint B
in float a_side;       // +1 / -1 across the ribbon
in float a_assignment; // crease type
uniform sampler2D u_lastPosition;
uniform sampler2D u_originalPosition;
uniform int u_textureDim;
uniform vec3 u_center;
uniform vec2 u_yaw;
uniform vec2 u_pitch;
uniform float u_scale;
uniform vec2 u_viewport;
uniform float u_depthRange;
uniform float u_camDist;
uniform float u_halfWidthPx;
flat out int v_assignment;

vec3 fetchPosition(int index){
  ivec2 texel = ivec2(index % u_textureDim, index / u_textureDim);
  return texelFetch(u_lastPosition, texel, 0).xyz + texelFetch(u_originalPosition, texel, 0).xyz;
}

vec2 projectNdc(int index){
  vec3 d = fetchPosition(index) - u_center;
  float yawX =  u_yaw.x*d.x + u_yaw.y*d.z;
  float yawZ = -u_yaw.y*d.x + u_yaw.x*d.z;
  float x = yawX;
  float y = u_pitch.x*yawZ - u_pitch.y*d.y;
  float depth = u_pitch.y*yawZ + u_pitch.x*d.y;
  // Same one-point perspective as the face pass, so creases sit on their faces.
  float persp = u_camDist / max(u_camDist - depth, 0.001);
  return vec2(x*persp*u_scale/(u_viewport.x*0.5), y*persp*u_scale/(u_viewport.y*0.5));
}

float projectDepth(int index){
  vec3 d = fetchPosition(index) - u_center;
  float yawZ = -u_yaw.y*d.x + u_yaw.x*d.z;
  float depth = u_pitch.y*yawZ + u_pitch.x*d.y;
  return clamp(-depth/u_depthRange, -1.0, 1.0);
}

void main(){
  v_assignment = int(a_assignment + 0.5);
  vec2 ndcThis = projectNdc(int(a_this + 0.5));
  vec2 ndcA = projectNdc(int(a_a + 0.5));
  vec2 ndcB = projectNdc(int(a_b + 0.5));
  // Perpendicular in pixel space so the ribbon has constant on-screen width
  // regardless of aspect ratio.
  vec2 dirPx = (ndcB - ndcA) * u_viewport * 0.5;
  float len = length(dirPx);
  vec2 perpPx = len > 0.0001 ? vec2(-dirPx.y, dirPx.x) / len : vec2(0.0);
  vec2 offsetNdc = (perpPx * u_halfWidthPx * a_side) / (u_viewport * 0.5);
  // Bias toward the viewer so creases sit on top of the faces they lie on.
  float depth = projectDepth(int(a_this + 0.5)) - 0.0008;
  gl_Position = vec4(ndcThis + offsetNdc, depth, 1.0);
}`;

const EDGE_FRAG = `#version 300 es
precision highp float;
flat in int v_assignment;
// Codes match EDGE_ASSIGNMENT_CODES: 0=B, 1=M, 2=V.
uniform vec3 u_mountainColor;
uniform vec3 u_valleyColor;
uniform vec3 u_borderColor;
uniform float u_alpha;
out vec4 fragColor;
void main(){
  vec3 color = u_borderColor;
  if (v_assignment == 1) color = u_mountainColor;
  else if (v_assignment == 2) color = u_valleyColor;
  fragColor = vec4(color, u_alpha);
}`;

export class MeshRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly faceProgram: WebGLProgram;
  private readonly edgeProgram: WebGLProgram;
  private readonly faceElements: WebGLBuffer;
  private readonly edgeBuffer: WebGLBuffer;
  private readonly faceVao: WebGLVertexArrayObject;
  private readonly edgeVao: WebGLVertexArrayObject;
  private readonly faceCount: number;
  private readonly edgeVertexCount: number;
  private readonly textureDim: number;
  private readonly faceUniforms: Map<string, WebGLUniformLocation | null> = new Map();
  private readonly edgeUniforms: Map<string, WebGLUniformLocation | null> = new Map();

  constructor(
    private readonly core: GlCore,
    topology: MeshTopology
  ) {
    const gl = core.gl;
    this.gl = gl;
    this.textureDim = topology.textureDim;
    this.faceCount = topology.faceIndices.length;

    this.faceProgram = compile(gl, FACE_VERT, FACE_FRAG);
    this.edgeProgram = compile(gl, EDGE_VERT, EDGE_FRAG);

    // Face pass: positions come from the texture via gl_VertexID, so the VAO
    // only holds the element buffer (no vertex attributes).
    this.faceVao = createVao(gl);
    this.faceElements = uploadElements(gl, topology.faceIndices);
    gl.bindVertexArray(this.faceVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceElements);

    // Edge pass: each drawn crease becomes a 2-triangle screen-space ribbon (6
    // vertices), interleaved as [this, a, b, side, assignment]. Facet edges (the
    // triangulation diagonals, assignment 3) are skipped -- they are not fold
    // lines and only clutter the view; so are unassigned/other (>2).
    const interleaved = buildEdgeQuads(topology);
    this.edgeVertexCount = interleaved.length / EDGE_STRIDE;
    this.edgeVao = createVao(gl);
    gl.bindVertexArray(this.edgeVao);
    this.edgeBuffer = uploadFloats(gl, interleaved);
    const stride = EDGE_STRIDE * 4;
    for (const [name, offset] of EDGE_ATTRS) {
      const loc = gl.getAttribLocation(this.edgeProgram, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, stride, offset * 4);
    }

    gl.bindVertexArray(null);
  }

  render(camera: CameraUniforms, settings: RenderSettings, target: WebGLFramebuffer | null): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    // The buffer may be larger than this render: it is shared by every inline
    // simulation window and sized to the largest of them, so each one draws into
    // the corner it needs. `clear` below ignores the viewport and covers the
    // whole buffer, which is what keeps a previous window's pixels out of this
    // one's crop.
    gl.viewport(0, 0, camera.width, camera.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // Straight (non-premultiplied) alpha, matching the context GlCore requests,
    // so the colour is left alone and only the alpha decides what shows through.
    gl.clearColor(
      settings.background[0],
      settings.background[1],
      settings.background[2],
      settings.backgroundAlpha ?? 1
    );
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const translucent = settings.faceAlpha < 1;
    if (settings.showFaces) {
      if (translucent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
      gl.bindVertexArray(this.faceVao);
      gl.useProgram(this.faceProgram);
      this.bindCommon(this.faceProgram, this.faceUniforms, camera);
      this.setVec3(this.faceProgram, this.faceUniforms, 'u_frontColor', settings.frontColor);
      this.setVec3(this.faceProgram, this.faceUniforms, 'u_backColor', settings.backColor);
      this.setVec3(this.faceProgram, this.faceUniforms, 'u_lightDir', settings.lightDir);
      this.setFloat(this.faceProgram, this.faceUniforms, 'u_lighting', settings.lighting ? 1 : 0);
      this.setFloat(this.faceProgram, this.faceUniforms, 'u_alpha', settings.faceAlpha);
      this.setFloat(
        this.faceProgram,
        this.faceUniforms,
        'u_strainMode',
        settings.colorMode === 'strain' ? 1 : 0
      );
      this.setFloat(
        this.faceProgram,
        this.faceUniforms,
        'u_strainClip',
        settings.strainClip ?? 5
      );
      gl.drawElements(gl.TRIANGLES, this.faceCount, gl.UNSIGNED_INT, 0);
    }

    if (settings.showEdges && this.edgeVertexCount > 0) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(this.edgeVao);
      gl.useProgram(this.edgeProgram);
      this.bindCommon(this.edgeProgram, this.edgeUniforms, camera);
      this.setVec3(this.edgeProgram, this.edgeUniforms, 'u_mountainColor', settings.mountainColor);
      this.setVec3(this.edgeProgram, this.edgeUniforms, 'u_valleyColor', settings.valleyColor);
      this.setVec3(this.edgeProgram, this.edgeUniforms, 'u_borderColor', settings.borderColor);
      // Crease width in device pixels; scaled up a touch on hi-dpi so it reads
      // at the same on-screen weight. camera.width is device px.
      const halfWidth = settings.creaseWidthPx * 0.5;
      this.setFloat(this.edgeProgram, this.edgeUniforms, 'u_halfWidthPx', halfWidth);
      this.setFloat(this.edgeProgram, this.edgeUniforms, 'u_alpha', 1);
      gl.drawArrays(gl.TRIANGLES, 0, this.edgeVertexCount);
    }

    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.faceProgram);
    gl.deleteProgram(this.edgeProgram);
    gl.deleteBuffer(this.faceElements);
    gl.deleteBuffer(this.edgeBuffer);
    gl.deleteVertexArray(this.faceVao);
    gl.deleteVertexArray(this.edgeVao);
  }

  private bindCommon(
    program: WebGLProgram,
    cache: Map<string, WebGLUniformLocation | null>,
    camera: CameraUniforms
  ): void {
    const gl = this.gl;
    // Position textures live in the solver's GlCore; bind them to units 0/1.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.core.getTexture('u_lastPosition'));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.core.getTexture('u_originalPosition'));
    // Unit 2 carries the velocity texture, whose alpha is the per-node strain the
    // strain colour mode reads. Bound for every pass so the face program can
    // sample it without a separate binding path.
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.core.getTexture('u_lastVelocity'));
    this.setInt(program, cache, 'u_lastPosition', 0);
    this.setInt(program, cache, 'u_originalPosition', 1);
    this.setInt(program, cache, 'u_lastVelocity', 2);
    this.setInt(program, cache, 'u_textureDim', this.textureDim);
    this.setVec3(program, cache, 'u_center', camera.center);
    this.setVec2(program, cache, 'u_yaw', [camera.cosYaw, camera.sinYaw]);
    this.setVec2(program, cache, 'u_pitch', [camera.cosPitch, camera.sinPitch]);
    this.setFloat(program, cache, 'u_scale', camera.scale);
    this.setVec2(program, cache, 'u_viewport', [camera.width, camera.height]);
    this.setFloat(program, cache, 'u_depthRange', camera.depthRange);
    this.setFloat(program, cache, 'u_camDist', camera.camDist);
  }

  private location(
    program: WebGLProgram,
    cache: Map<string, WebGLUniformLocation | null>,
    name: string
  ): WebGLUniformLocation | null {
    let location = cache.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(program, name);
      cache.set(name, location);
    }
    return location;
  }

  private setInt(p: WebGLProgram, c: Map<string, WebGLUniformLocation | null>, n: string, v: number): void {
    this.gl.uniform1i(this.location(p, c, n), v);
  }
  private setFloat(p: WebGLProgram, c: Map<string, WebGLUniformLocation | null>, n: string, v: number): void {
    this.gl.uniform1f(this.location(p, c, n), v);
  }
  private setVec2(p: WebGLProgram, c: Map<string, WebGLUniformLocation | null>, n: string, v: [number, number]): void {
    this.gl.uniform2f(this.location(p, c, n), v[0], v[1]);
  }
  private setVec3(
    p: WebGLProgram,
    c: Map<string, WebGLUniformLocation | null>,
    n: string,
    v: [number, number, number]
  ): void {
    this.gl.uniform3f(this.location(p, c, n), v[0], v[1], v[2]);
  }
}

function compile(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create mesh render program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Mesh render program failed to link: ${info}`);
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`Mesh shader failed to compile: ${info}`);
  }
  return shader;
}

function uploadElements(gl: WebGL2RenderingContext, data: Uint32Array): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Unable to create element buffer');
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function uploadFloats(gl: WebGL2RenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Unable to create attribute buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function createVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Unable to create VAO for the mesh renderer');
  return vao;
}

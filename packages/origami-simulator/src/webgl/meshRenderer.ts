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
  facetColor: [number, number, number];
  lightDir: [number, number, number];
  background: [number, number, number];
  showFaces: boolean;
  showEdges: boolean;
  lighting: boolean;
  /** 0..1; below 1 draws faces translucent with depth write off (x-ray). */
  faceAlpha: number;
}

const FACE_VERT = `#version 300 es
precision highp float;
uniform sampler2D u_lastPosition;
uniform sampler2D u_originalPosition;
uniform int u_textureDim;
uniform vec3 u_center;
uniform vec2 u_yaw;   // cos, sin
uniform vec2 u_pitch; // cos, sin
uniform float u_scale;
uniform vec2 u_viewport;
uniform float u_depthRange;
out vec3 v_view;

vec3 fetchPosition(int index){
  ivec2 texel = ivec2(index % u_textureDim, index / u_textureDim);
  return texelFetch(u_lastPosition, texel, 0).xyz + texelFetch(u_originalPosition, texel, 0).xyz;
}

void main(){
  vec3 d = fetchPosition(gl_VertexID) - u_center;
  float yawX =  u_yaw.x*d.x + u_yaw.y*d.z;
  float yawZ = -u_yaw.y*d.x + u_yaw.x*d.z;
  float x = yawX;
  float y = u_pitch.x*yawZ - u_pitch.y*d.y;
  float depth = u_pitch.y*yawZ + u_pitch.x*d.y;
  v_view = vec3(x, y, depth);
  gl_Position = vec4(
    x*u_scale/(u_viewport.x*0.5),
    y*u_scale/(u_viewport.y*0.5),
    clamp(-depth/u_depthRange, -1.0, 1.0),
    1.0
  );
}`;

const FACE_FRAG = `#version 300 es
precision highp float;
in vec3 v_view;
uniform vec3 u_frontColor;
uniform vec3 u_backColor;
uniform vec3 u_lightDir;
uniform float u_lighting;
uniform float u_alpha;
out vec4 fragColor;

void main(){
  vec3 normal = normalize(cross(dFdx(v_view), dFdy(v_view)));
  vec3 base = gl_FrontFacing ? u_frontColor : u_backColor;
  float shade = 1.0;
  if (u_lighting > 0.5){
    vec3 n = normal.z < 0.0 ? -normal : normal;
    float diffuse = max(0.0, dot(n, normalize(u_lightDir)));
    shade = clamp(0.74 + diffuse*0.3 + n.z*0.04, 0.68, 1.08);
  }
  fragColor = vec4(base*shade, u_alpha);
}`;

const EDGE_VERT = `#version 300 es
precision highp float;
// Per-endpoint attributes: which node to fetch, and this edge's assignment. An
// explicit vertex buffer (not gl_VertexID) so each edge can carry its crease
// type through to the fragment shader for colouring.
in float a_nodeIndex;
in float a_assignment;
uniform sampler2D u_lastPosition;
uniform sampler2D u_originalPosition;
uniform int u_textureDim;
uniform vec3 u_center;
uniform vec2 u_yaw;
uniform vec2 u_pitch;
uniform float u_scale;
uniform vec2 u_viewport;
uniform float u_depthRange;
flat out int v_assignment;

vec3 fetchPosition(int index){
  ivec2 texel = ivec2(index % u_textureDim, index / u_textureDim);
  return texelFetch(u_lastPosition, texel, 0).xyz + texelFetch(u_originalPosition, texel, 0).xyz;
}

void main(){
  v_assignment = int(a_assignment + 0.5);
  vec3 d = fetchPosition(int(a_nodeIndex + 0.5)) - u_center;
  float yawX =  u_yaw.x*d.x + u_yaw.y*d.z;
  float yawZ = -u_yaw.y*d.x + u_yaw.x*d.z;
  float x = yawX;
  float y = u_pitch.x*yawZ - u_pitch.y*d.y;
  float depth = u_pitch.y*yawZ + u_pitch.x*d.y;
  gl_Position = vec4(
    x*u_scale/(u_viewport.x*0.5),
    y*u_scale/(u_viewport.y*0.5),
    // Nudge edges toward the viewer so they win the depth test against the
    // faces they sit on, the LINES analogue of polygonOffset.
    clamp(-depth/u_depthRange, -1.0, 1.0) - 0.0006,
    1.0
  );
}`;

const EDGE_FRAG = `#version 300 es
precision highp float;
flat in int v_assignment;
// Codes match EDGE_ASSIGNMENT_CODES: 0=B, 1=M, 2=V, 3=F.
uniform vec3 u_mountainColor;
uniform vec3 u_valleyColor;
uniform vec3 u_borderColor;
uniform vec3 u_facetColor;
uniform float u_alpha;
out vec4 fragColor;
void main(){
  vec3 color = u_borderColor;
  if (v_assignment == 1) color = u_mountainColor;
  else if (v_assignment == 2) color = u_valleyColor;
  else if (v_assignment == 3) color = u_facetColor;
  fragColor = vec4(color, u_alpha);
}`;

export class MeshRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly faceProgram: WebGLProgram;
  private readonly edgeProgram: WebGLProgram;
  private readonly faceElements: WebGLBuffer;
  private readonly edgeNodeBuffer: WebGLBuffer;
  private readonly edgeAssignBuffer: WebGLBuffer;
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
    const edgeCount = topology.edgeAssignments.length;
    this.edgeVertexCount = edgeCount * 2;

    this.faceProgram = compile(gl, FACE_VERT, FACE_FRAG);
    this.edgeProgram = compile(gl, EDGE_VERT, EDGE_FRAG);

    // Face pass: positions come from the texture via gl_VertexID, so the VAO
    // only holds the element buffer (no vertex attributes).
    this.faceVao = createVao(gl);
    this.faceElements = uploadElements(gl, topology.faceIndices);
    gl.bindVertexArray(this.faceVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceElements);

    // Edge pass: one vertex per edge endpoint, drawn with drawArrays, carrying
    // its node index (to fetch the position) and its crease assignment (to pick
    // the colour). edgeIndices is already node-index-per-endpoint.
    const nodeIndices = Float32Array.from(topology.edgeIndices);
    const assignments = new Float32Array(this.edgeVertexCount);
    for (let e = 0; e < edgeCount; e += 1) {
      assignments[e * 2] = topology.edgeAssignments[e]!;
      assignments[e * 2 + 1] = topology.edgeAssignments[e]!;
    }
    this.edgeVao = createVao(gl);
    gl.bindVertexArray(this.edgeVao);
    const nodeLoc = gl.getAttribLocation(this.edgeProgram, 'a_nodeIndex');
    const assignLoc = gl.getAttribLocation(this.edgeProgram, 'a_assignment');
    this.edgeNodeBuffer = uploadFloats(gl, nodeIndices);
    gl.enableVertexAttribArray(nodeLoc);
    gl.vertexAttribPointer(nodeLoc, 1, gl.FLOAT, false, 0, 0);
    this.edgeAssignBuffer = uploadFloats(gl, assignments);
    gl.enableVertexAttribArray(assignLoc);
    gl.vertexAttribPointer(assignLoc, 1, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  render(camera: CameraUniforms, settings: RenderSettings, target: WebGLFramebuffer | null): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, camera.width, camera.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(settings.background[0], settings.background[1], settings.background[2], 1);
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
      gl.drawElements(gl.TRIANGLES, this.faceCount, gl.UNSIGNED_INT, 0);
    }

    if (settings.showEdges) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(this.edgeVao);
      gl.useProgram(this.edgeProgram);
      this.bindCommon(this.edgeProgram, this.edgeUniforms, camera);
      this.setVec3(this.edgeProgram, this.edgeUniforms, 'u_mountainColor', settings.mountainColor);
      this.setVec3(this.edgeProgram, this.edgeUniforms, 'u_valleyColor', settings.valleyColor);
      this.setVec3(this.edgeProgram, this.edgeUniforms, 'u_borderColor', settings.borderColor);
      this.setVec3(this.edgeProgram, this.edgeUniforms, 'u_facetColor', settings.facetColor);
      this.setFloat(this.edgeProgram, this.edgeUniforms, 'u_alpha', 1);
      gl.drawArrays(gl.LINES, 0, this.edgeVertexCount);
    }

    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.faceProgram);
    gl.deleteProgram(this.edgeProgram);
    gl.deleteBuffer(this.faceElements);
    gl.deleteBuffer(this.edgeNodeBuffer);
    gl.deleteBuffer(this.edgeAssignBuffer);
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
    this.setInt(program, cache, 'u_lastPosition', 0);
    this.setInt(program, cache, 'u_originalPosition', 1);
    this.setInt(program, cache, 'u_textureDim', this.textureDim);
    this.setVec3(program, cache, 'u_center', camera.center);
    this.setVec2(program, cache, 'u_yaw', [camera.cosYaw, camera.sinYaw]);
    this.setVec2(program, cache, 'u_pitch', [camera.cosPitch, camera.sinPitch]);
    this.setFloat(program, cache, 'u_scale', camera.scale);
    this.setVec2(program, cache, 'u_viewport', [camera.width, camera.height]);
    this.setFloat(program, cache, 'u_depthRange', camera.depthRange);
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

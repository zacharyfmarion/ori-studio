import { prepareOrder, orientOrder } from './order.mjs';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => {
  const n = Math.hypot(...a);
  return a.map((x) => x / Math.max(n, 1e-20));
};
export const basis = ([x, y, z]) => [x, z, -y];
function multiply(a, b) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  return r;
}
export function cameraMatrix(eye, aspect) {
  const z = unit(eye),
    x = unit(cross([0, 1, 0], z)),
    y = cross(z, x);
  const view = [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ];
  const f = 1 / Math.tan(Math.PI / 10),
    near = 0.01,
    far = 200;
  const projection = [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ];
  return multiply(projection, view);
}
const vertexShader = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute float aSide;
uniform mat4 uMatrix; varying vec3 vPosition; varying vec3 vNormal; varying float vSide;
void main(){vPosition=aPosition;vNormal=aNormal;vSide=aSide;gl_Position=uMatrix*vec4(aPosition,1.0);}`;
const fragmentShader = `
precision highp float;
varying vec3 vPosition; varying vec3 vNormal; varying float vSide;
uniform float uDebugFace;
uniform vec3 uEye; uniform bool uBase; uniform bool uLines;
void main(){
  if(uDebugFace>=0.0){gl_FragColor=vec4((uDebugFace+1.0)*32.0/255.0,0.0,0.0,1.0);return;}
  if(uLines){
    if(uBase && dot(vNormal,uEye-vPosition)<=0.0) discard;
    gl_FragColor=vec4(0.29,0.38,0.34,1.0);return;
  }
  bool front=uBase ? vSide>0.0 : gl_FrontFacing;
  vec3 normal=normalize(vNormal)*(uBase || gl_FrontFacing ? 1.0 : -1.0);
  vec3 color=front ? vec3(0.89,0.94,0.89) : vec3(0.48,0.69,0.61);
  float shade=0.68+0.32*max(dot(normal,normalize(vec3(-0.35,0.85,0.65))),0.0);
  gl_FragColor=vec4(color*shade,1.0);
}`;

export class Renderer {
  constructor(canvas, requestFrame = () => {}, debugFaces = false) {
    this.requestFrame = requestFrame;
    this.debugFaces = debugFaces;
    this.planes = [];
    this.ranges = new Map();
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl', {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      stencil: true,
    }));
    if (!gl) throw new Error('WebGL is unavailable in this browser.');
    if (gl.getParameter(gl.STENCIL_BITS) < 2)
      throw new Error(
        'This study requires a stencil buffer for layer-order correction.'
      );
    const shader = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = (this.program = gl.createProgram());
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p));
    this.locations = Object.fromEntries(
      ['aPosition', 'aNormal', 'aSide'].map((n) => [
        n,
        gl.getAttribLocation(p, n),
      ])
    );
    this.uniforms = Object.fromEntries(
      ['uMatrix', 'uEye', 'uBase', 'uLines', 'uDebugFace'].map((n) => [
        n,
        gl.getUniformLocation(p, n),
      ])
    );
    this.fills = gl.createBuffer();
    this.lines = gl.createBuffer();
    this.fillCount = 0;
    this.lineCount = 0;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.977, 0.981, 0.969, 1);
    new ResizeObserver(requestFrame).observe(canvas);
  }
  upload(fills, lines, base, ranges = new Map()) {
    this.ranges = ranges;
    const gl = this.gl;
    this.base = base;
    for (const [buffer, data] of [
      [this.fills, fills],
      [this.lines, lines],
    ]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    }
    this.fillCount = fills.length / 7;
    this.lineCount = lines.length / 7;
  }
  bind(buffer) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, size, offset] of [
      ['aPosition', 3, 0],
      ['aNormal', 3, 12],
      ['aSide', 1, 24],
    ]) {
      const at = this.locations[name];
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, 28, offset);
    }
  }
  configureOrder(source) {
    this.planes = prepareOrder(
      source.map((p) => ({
        ...p,
        normal: basis(p.normal),
        origin: basis(p.origin),
      }))
    );
  }
  surface(lines, face) {
    const gl = this.gl,
      range = face === undefined ? null : this.ranges.get(face);
    gl.uniform1i(this.uniforms.uLines, lines ? 1 : 0);
    gl.uniform1f(
      this.uniforms.uDebugFace,
      this.debugFaces && face !== undefined ? face : -1
    );
    if (lines) gl.disable(gl.POLYGON_OFFSET_FILL);
    else gl.enable(gl.POLYGON_OFFSET_FILL);
    this.bind(lines ? this.lines : this.fills);
    gl.drawArrays(
      lines ? gl.LINES : gl.TRIANGLES,
      range ? (lines ? range.lineFirst : range.first) : 0,
      range
        ? lines
          ? range.lineCount
          : range.count
        : lines
          ? this.lineCount
          : this.fillCount
    );
  }
  corrected(planes, ink) {
    const gl = this.gl;
    gl.enable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    for (const plane of planes) {
      // Bit 1 masks this face's blockers. Bit 2 records ALL survivor coverage,
      // including survivors hidden by another plane. Physical fallback for a
      // cycle must never leak through a survivor hidden by unrelated paper.
      gl.stencilMask(0xff);
      gl.clearStencil(0);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      for (const face of plane.faces) {
        gl.stencilMask(1);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 1, 1);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        for (const blocker of plane.blockers.get(face))
          this.surface(false, blocker);
        gl.enable(gl.DEPTH_TEST);
        gl.stencilMask(2);
        gl.stencilFunc(gl.EQUAL, 2, 1);
        gl.stencilOp(gl.KEEP, gl.REPLACE, gl.REPLACE);
        gl.colorMask(!ink, !ink, !ink, !ink);
        gl.depthMask(!ink);
        this.surface(false, face);
        if (ink) {
          gl.stencilMask(0);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          gl.colorMask(true, true, true, true);
          this.surface(true, face);
        }
      }
      if (plane.cyclic) {
        gl.stencilMask(0);
        gl.stencilFunc(gl.EQUAL, 0, 2);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        gl.colorMask(true, true, true, true);
        gl.depthMask(!ink);
        for (const face of plane.faces) this.surface(ink, face);
      }
    }
  }
  draw(eye, { edges = true, correctOrder = true } = {}) {
    const gl = this.gl,
      c = this.canvas,
      dpr = Math.min(devicePixelRatio, 2);
    const width = Math.max(1, Math.round(c.clientWidth * dpr)),
      height = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
    }
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(
      this.uniforms.uMatrix,
      false,
      cameraMatrix(eye, width / height)
    );
    gl.uniform3fv(this.uniforms.uEye, eye);
    gl.uniform1i(this.uniforms.uBase, this.base ? 1 : 0);
    gl.uniform1i(this.uniforms.uLines, 0);
    if (this.base) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.uniform1f(this.uniforms.uDebugFace, -1);
    gl.polygonOffset(1, 1);
    if (correctOrder && !this.base && this.planes.length) {
      const planes = orientOrder(this.planes, eye);
      this.corrected(planes, false);
      if (edges) this.corrected(planes, true);
    } else {
      const physical = (lines) => {
        if (this.debugFaces)
          for (const face of this.ranges.keys()) this.surface(lines, face);
        else this.surface(lines);
      };
      physical(false);
      if (edges) {
        gl.disable(gl.CULL_FACE);
        physical(true);
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
  }
}

/** Local research renderer: real depth-tested surfaces and screen-width edges. */
import type { CameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import type { CameraSpreadOptions } from '../../cp-workspace/folded/cameraSpreadScene';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';

const VERTEX = `#version 300 es
precision highp float;
in vec3 position;
in vec3 other;
in float side;
uniform float amount, angle, tilt, mode, aspect, zoom, edgePass;
uniform vec2 centre, pan, pixels;
vec4 project(vec3 p) {
  vec2 q=p.xy-centre;
  vec2 u=vec2(cos(angle),sin(angle));
  vec2 v=vec2(-u.y,u.x);
  float along=dot(q,u), across=dot(q,v), z=p.z*amount;
  float horizontal=along*cos(tilt)-z*sin(tilt);
  float depth=along*sin(tilt)+z*cos(tilt);
  if(mode<0.5) horizontal/=cos(tilt);
  vec2 screen=u*horizontal+v*across;
  float w=mode>1.5 ? (2.5-depth)/2.5 : 1.0;
  // Perspective depth must interpolate in reciprocal distance, not linearly in Z.
  float clipZ=mode>1.5 ? 1.020202*w-0.080808 : -depth/2.0;
  return vec4((screen.x+pan.x*w)*zoom/aspect,-(screen.y+pan.y*w)*zoom,clipZ,w);
}
void main(){
  vec4 p=project(position);
  if(edgePass>0.5){
    vec4 b=project(other);
    vec2 d=(b.xy/b.w-p.xy/p.w)*pixels;
    float len=length(d);
    vec2 n=len>0.00001?vec2(-d.y,d.x)/len:vec2(0.0);
    p.xy+=n*side*1.1/pixels*p.w;
    p.z-=0.0000001*p.w;
  }
  gl_Position=p;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform float edgePass, wire;
out vec4 color;
void main(){color=edgePass>0.5 ? (wire>0.5?vec4(.65,.22,.50,1.):vec4(.12,.14,.18,1.)) : (gl_FrontFacing?vec4(1.,.89,.46,1.):vec4(.88,.90,.92,1.));}`;

export function createCameraRenderer(
  canvas: HTMLCanvasElement,
  mesh: CameraSpreadLift,
  kernel: OristudioCpFoldedPaperScene
) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL2 is required for the camera research preview');
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error('Could not allocate camera shader');
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'Shader compilation failed');
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!program) throw new Error('Could not allocate camera program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
  gl.useProgram(program);
  const at = (v: number) => [mesh.xy[v]!.x, mesh.xy[v]!.y, mesh.heights[v]!];
  const faces: number[] = [];
  const lines: number[] = [];
  const wire: number[] = [];
  const addLine = (data: number[], a: number, b: number) => {
    const pa = at(a);
    const pb = at(b);
    for (const [end, sign] of [
      [0, 1],
      [1, -1],
      [0, -1],
      [0, -1],
      [1, -1],
      [1, 1],
    ])
      data.push(...(end === 0 ? pa : pb), ...(end === 0 ? pb : pa), sign!);
  };
  for (const { vertices, face } of mesh.triangles) {
    const ids = [...vertices];
    const [a, b, c] = ids.map((v) => mesh.xy[v]!);
    const cross = (b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x);
    if (cross < 0 !== kernel.faces[face]!.front_up) [ids[1], ids[2]] = [ids[2]!, ids[1]!];
    for (const v of ids) faces.push(...at(v), 0, 0, 0, 0);
    for (let i = 0; i < 3; i++) addLine(wire, vertices[i]!, vertices[(i + 1) % 3]!);
  }
  const seen = new Set<string>();
  for (const ring of mesh.faceVertices)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (!seen.has(key)) {
        seen.add(key);
        addLine(lines, a, b);
      }
    }
  const buffer = (data: number[]) => {
    const b = gl.createBuffer();
    if (!b) throw new Error('Could not allocate camera buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return b;
  };
  const buffers = [buffer(faces), buffer(lines), buffer(wire)];
  const attributes = ['position', 'other', 'side'].map((name) => gl.getAttribLocation(program, name));
  const bind = (index: number) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[index]!);
    [3, 3, 1].forEach((size, i) => {
      gl.enableVertexAttribArray(attributes[i]!);
      gl.vertexAttribPointer(attributes[i]!, size, gl.FLOAT, false, 28, i === 0 ? 0 : i === 1 ? 12 : 24);
    });
  };
  const uniform = (name: string, value: number) => gl.uniform1f(gl.getUniformLocation(program, name), value);
  const xs = mesh.xy.map((p) => p.x),
    ys = mesh.xy.map((p) => p.y);
  const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  gl.uniform2f(gl.getUniformLocation(program, 'centre'), centre[0]!, centre[1]!);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  return {
    draw(options: CameraSpreadOptions, zoom = 1, showWire = false, pan: [number, number] = [0, 0]) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      uniform('amount', options.amount);
      uniform('angle', (options.directionDeg * Math.PI) / 180);
      uniform(
        'tilt',
        ((options.projection === 'diagram' ? Math.min(80, options.inclinationDeg) : options.inclinationDeg) *
          Math.PI) /
          180
      );
      uniform('mode', ['diagram', 'orthographic', 'perspective'].indexOf(options.projection));
      uniform('aspect', canvas.width / canvas.height);
      uniform('zoom', 1.45 * zoom);
      uniform('wire', 0);
      gl.uniform2f(gl.getUniformLocation(program, 'pixels'), canvas.width / 2, canvas.height / 2);
      gl.uniform2f(gl.getUniformLocation(program, 'pan'), pan[0], pan[1]);
      bind(0);
      uniform('edgePass', 0);
      gl.drawArrays(gl.TRIANGLES, 0, faces.length / 7);
      bind(1);
      uniform('edgePass', 1);
      gl.drawArrays(gl.TRIANGLES, 0, lines.length / 7);
      if (showWire) {
        bind(2);
        uniform('wire', 1);
        gl.drawArrays(gl.TRIANGLES, 0, wire.length / 7);
      }
    },
    dispose() {
      buffers.forEach((b) => gl.deleteBuffer(b));
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

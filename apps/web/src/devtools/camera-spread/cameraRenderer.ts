/** Camera geometry with authoritative diagram layers, including woven patches. */
import type { CameraPaintPlan, CameraPaintPlans } from '../../cp-workspace/folded/cameraSpreadVisibility';
import type { CameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import {
  cameraSpreadVisibilityMode,
  type CameraSpreadOptions,
} from '../../cp-workspace/folded/cameraSpreadScene';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { transposeMat3 } from '@treemaker/origami-simulator';
import { cameraSpreadTransform } from '../../cp-workspace/folded/cameraSpreadCamera';
import { createCameraDepthMask } from './cameraDepthMask';
import { createCameraRankMap } from './cameraRankMap';
import { cameraPaintRanks } from '../../cp-workspace/folded/cameraSpreadOrder';

const VERTEX = `#version 300 es
precision highp float;
in vec3 position;
in vec3 other;
in float side;
in vec3 paint;
in vec4 plane;
flat out vec3 style;
flat out float backFacing;
uniform float amount, mode, aspect, zoom, layerMode, slots, showWire;
uniform mat3 camera;
uniform vec2 centre, pan, pixels;
uniform sampler2D rankMap;
vec4 project(vec3 p) {
  vec3 view=camera*vec3(p.xy-centre,p.z*amount);
  vec2 screen=view.xy;
  float depth=view.z;
  float w=mode>1.5 ? (2.5-depth)/2.5 : 1.0;
  // Perspective depth must interpolate in reciprocal distance, not linearly in Z.
  float clipZ=mode>1.5 ? 1.020202*w-0.080808 : -depth/2.0;
  return vec4((screen.x+pan.x*w)*zoom/aspect,-(screen.y+pan.y*w)*zoom,clipZ,w);
}
void main(){
  vec4 p=project(position);
  style=paint;
  int item=int(paint.x);
  style.x=texelFetch(rankMap,ivec2(item%256,item/256),0).r;
  // Use the source surface's +Z plane, including for line quads and woven
  // patches. gl_FrontFacing encodes paper colour, not the side of the stack.
  vec3 normal=vec3(plane.xy*amount,plane.z);
  float facing=dot(normal,vec3(camera[0][2],camera[1][2],camera[2][2]));
  if(mode>1.5) facing=2.5*facing+dot(normal.xy,centre)+plane.w*amount;
  backFacing=mode>.5 && facing<0. ? 1. : 0.;
  if(layerMode>.5 && layerMode<1.5) {
    // Disjoint slots protect layers even if the approximate lift intersects.
    float within=clamp(-p.z/p.w,-1.,1.)*.2;
    p.z=(1.-2.*(style.x+.5+within)/slots)*p.w;
  }
  if(paint.y>0.5){
    vec4 b=project(other);
    vec2 d=(b.xy/b.w-p.xy/p.w)*pixels;
    float len=length(d);
    vec2 n=len>0.00001?vec2(-d.y,d.x)/len:vec2(0.0);
    p.xy+=n*side*(paint.y>1.5 && paint.y<2.5 ? .65 : 1.1)/pixels*p.w;
    p.z-=(layerMode>.5 && layerMode<1.5 ? .05/slots : .0000001)*p.w;
  }
  gl_Position=p;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
flat in vec3 style;
flat in float backFacing;
uniform float layerMode, showWire, backPlan, slots;
uniform sampler2D layerMask;
out vec4 color;
void main(){
  if(layerMode<.5 && style.z>.5) discard;
  if(layerMode>.5 && backFacing!=backPlan) discard;
  if(layerMode>1.5) {
    // Only the protected winner on this side may participate in the final
    // geometric depth comparison with surfaces facing the opposite way.
    float depth=texelFetch(layerMask,ivec2(gl_FragCoord.xy),0).r;
    float rank=floor((1.-depth)*slots);
    if(abs(rank-style.x)>.25) discard;
  }
  if(style.y>2.5 && showWire<.5) discard;
  color=style.y>2.5 ? vec4(.65,.22,.50,1.) :
    style.y>1.5 ? vec4(.63,.65,.68,1.) :
    style.y>.5 ? vec4(.12,.14,.18,1.) :
    (gl_FrontFacing?vec4(1.,.89,.46,1.):vec4(.88,.90,.92,1.));
}`;

export function createCameraRenderer(
  canvas: HTMLCanvasElement,
  mesh: CameraSpreadLift,
  kernel: OristudioCpFoldedPaperScene,
  plans: CameraPaintPlans
) {
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
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
  const buffer = (plan: CameraPaintPlan) => {
    const data: number[] = [];
    const line = (a: number[], b: number[], rank: number, ink: number, patch: number, plane: number[]) => {
      for (const [end, sign] of [
        [0, 1],
        [1, -1],
        [0, -1],
        [0, -1],
        [1, -1],
        [1, 1],
      ])
        data.push(...(end === 0 ? a : b), ...(end === 0 ? b : a), sign!, rank, ink, patch, ...plane);
    };
    for (const piece of plan.pieces) {
      const { rank, points, face, plane } = piece;
      const patch = Number(piece.patch);
      if (piece.kind === 'line') {
        line(points[0]!, points[1]!, rank, piece.role === 'aux' ? 2 : 1, patch, plane);
      } else {
        const [a, b, c] = points;
        const cross = (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0]);
        const ordered = cross < 0 !== kernel.faces[face]!.front_up ? [a!, c!, b!] : points;
        for (const p of ordered) data.push(...p, 0, 0, 0, 0, rank, 0, patch, ...plane);
        // Overlay remains in its face's depth slot, beneath every covering face.
        for (let i = 0; i < 3; i++) line(points[i]!, points[(i + 1) % 3]!, rank, 3, patch, plane);
      }
    }
    const b = gl.createBuffer();
    if (!b) throw new Error('Could not allocate camera buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return { buffer: b, count: data.length / 14, slots: plan.slots };
  };
  const buffers = [buffer(plans.front), buffer(plans.back)];
  const masks = [createCameraDepthMask(gl), createCameraDepthMask(gl)];
  const rankMaps = buffers.map((b) => createCameraRankMap(gl, b.slots));
  gl.uniform1i(gl.getUniformLocation(program, 'rankMap'), 1);
  const attributes = ['position', 'other', 'side', 'paint', 'plane'].map((name) =>
    gl.getAttribLocation(program, name)
  );
  const bind = (index: number) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[index]!.buffer);
    [3, 3, 1, 3, 4].forEach((size, i) => {
      gl.enableVertexAttribArray(attributes[i]!);
      gl.vertexAttribPointer(attributes[i]!, size, gl.FLOAT, false, 56, [0, 12, 24, 28, 40][i]!);
    });
  };
  const uniform = (name: string, value: number) => gl.uniform1f(gl.getUniformLocation(program, name), value);
  const xs = mesh.xy.map((p) => p.x),
    ys = mesh.xy.map((p) => p.y);
  gl.uniform2f(
    gl.getUniformLocation(program, 'centre'),
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2
  );
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  return {
    draw(options: CameraSpreadOptions, zoom = 1, showWire = false, pan: [number, number] = [0, 0]) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(canvas.clientWidth * dpr),
        height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const frame = cameraSpreadTransform(options);
      uniform('amount', options.amount);
      gl.uniformMatrix3fv(gl.getUniformLocation(program, 'camera'), false, transposeMat3(frame));
      uniform('mode', ['diagram', 'orthographic', 'perspective'].indexOf(options.projection));
      uniform('aspect', canvas.width / canvas.height);
      uniform('zoom', 1.45 * zoom);
      const layers = cameraSpreadVisibilityMode(options) === 'layers';
      [plans.front, plans.back].forEach((plan, index) => {
        rankMaps[index]!.update(cameraPaintRanks(mesh, kernel, plan, !!index, options, frame));
      });
      uniform('layerMode', Number(layers));
      uniform('slots', plans.front.slots);
      uniform('showWire', Number(showWire));
      gl.uniform2f(gl.getUniformLocation(program, 'pixels'), canvas.width / 2, canvas.height / 2);
      gl.uniform2f(gl.getUniformLocation(program, 'pan'), pan[0], pan[1]);
      const drawPlan = (index: number) => {
        rankMaps[index]!.bind();
        uniform('slots', buffers[index]!.slots);
        uniform('backPlan', index);
        bind(index);
        gl.drawArrays(gl.TRIANGLES, 0, buffers[index]!.count);
      };
      if (layers && options.projection !== 'diagram') {
        // Protect each local-facing stack separately, then compare its winning
        // surface geometrically with the opposite-facing stack. Interleaving
        // unrelated front/back ranks would let a distant back face overpaint
        // a near front face even after reversing it.
        for (const index of [0, 1]) {
          masks[index]!.bind(width, height);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          drawPlan(index);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        uniform('layerMode', 2);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(gl.getUniformLocation(program, 'layerMask'), 0);
        for (const index of [0, 1]) {
          gl.bindTexture(gl.TEXTURE_2D, masks[index]!.texture);
          drawPlan(index);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else {
        drawPlan(layers || frame[8] >= 0 ? 0 : 1);
      }
    },
    dispose() {
      buffers.forEach((b) => gl.deleteBuffer(b.buffer));
      masks.forEach((mask) => mask.dispose());
      rankMaps.forEach((map) => map.dispose());
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

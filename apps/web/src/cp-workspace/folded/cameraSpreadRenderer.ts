/** Camera geometry with authoritative diagram layers, including woven patches. */
import type { CameraPaintPlan, CameraPaintPlans } from './cameraSpreadVisibility';
import type { CameraSpreadLift } from './cameraSpreadLift';
import { cameraSpreadVisibilityMode, type CameraSpreadOptions } from './cameraSpreadScene';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import {
  transposeMat3,
  packCreaseDash,
  MAX_DASH_RUNS,
  DASH_KINDS,
  type RenderSettings,
} from '@treemaker/origami-simulator';
import { cameraSpreadTransform } from './cameraSpreadCamera';
import { cameraLayerRelations } from './cameraSpreadRelations';
import { createCameraOcclusion, CAMERA_OCCLUSION_GLSL } from './cameraSpreadOcclusion';

const VERTEX = `#version 300 es
precision highp float;
in vec3 position;
in vec3 other;
in float side;
in vec3 paint;
in vec4 plane;
in float faceId;
in vec3 wholeA, wholeB;
in float boundary;
out float along;
flat out float lineLength, erodeEnds;
flat out float owner;
flat out vec3 style;
flat out float backFacing;
uniform float amount, mode, aspect, zoom, layerMode, slots, showWire, inkScale;
uniform mat3 camera;
uniform vec2 centre, pan, pixels;
uniform vec2 inkWidths;
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
  along=0.; lineLength=0.; erodeEnds=boundary;
  owner=faceId;
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
    vec4 wa=project(wholeA), wb=project(wholeB);
    vec2 wholeDelta=(wb.xy/wb.w-wa.xy/wa.w)*pixels;
    lineLength=length(wholeDelta);
    along=lineLength>1.e-8 ? dot((p.xy/p.w-wa.xy/wa.w)*pixels,wholeDelta)/lineLength*p.w : 0.;
    vec2 d=(b.xy/b.w-p.xy/p.w)*pixels;
    float len=length(d);
    vec2 n=len>0.00001?vec2(-d.y,d.x)/len:vec2(0.0);
    // Full stroke widths in CSS pixels; expand only half to each side.
    float strokeWidth=paint.y>1.5 && paint.y<2.5 ? inkWidths.y : inkWidths.x;
    vec2 offset=n*side*.5*strokeWidth*inkScale/pixels;
    if(layerMode<.5 || layerMode>1.5) {
      // Ink's pixel-width quad follows its source surface's depth slope. A
      // constant-depth ribbon sinks into a tilted panel and breaks its lines.
      vec4 tx=project(position+vec3(.01,0.,-.01*plane.x/plane.z));
      vec4 ty=project(position+vec3(0.,.01,-.01*plane.y/plane.z));
      vec3 clipNormal=cross(tx.xyz/tx.w-p.xyz/p.w,ty.xyz/ty.w-p.xyz/p.w);
      if(abs(clipNormal.z)>1.e-12) p.z-=dot(clipNormal.xy,offset)/clipNormal.z*p.w;
    }
    p.xy+=offset*p.w;
    p.z-=(layerMode>.5 && layerMode<1.5 ? .05/slots : .00005)*p.w;
  }
  gl_Position=p;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
flat in vec3 style;
flat in float backFacing;
uniform float layerMode, showWire, backPlan, slots;
uniform vec3 frontColor, backColor, edgeColor, auxColor;
uniform float showAux, showEdges, erodePx;
in float along;
flat in float lineLength, erodeEnds;
uniform float dashRuns[${DASH_KINDS * MAX_DASH_RUNS}];
uniform int dashCounts[${DASH_KINDS}];
bool dashOn(int kind, float distance) {
  int count=dashCounts[kind];
  if(count==0) return true;
  int base=kind*${MAX_DASH_RUNS};
  float total=0.;
  for(int i=0;i<${MAX_DASH_RUNS};i++) { if(i>=count) break; total+=dashRuns[base+i]; }
  if(total<=0.) return true;
  float phase=mod(dashRuns[base]*.5-lineLength*.5,total);
  float at=mod(distance+phase,total), acc=0.;
  for(int i=0;i<${MAX_DASH_RUNS};i++) {
    if(i>=count) break; acc+=dashRuns[base+i];
    if(at<acc) return (i%2)==0;
  }
  return true;
}
out vec4 color;
${CAMERA_OCCLUSION_GLSL}
void main(){
  if(style.y>2.5 && showWire<.5) discard;
  if(style.y>.5 && style.y<2.5) {
    if(showEdges<.5) discard;
    float distance=along*gl_FragCoord.w;
    if(style.y>1.5 && ((mod(erodeEnds,2.)>.5 && distance<erodePx) ||
      (erodeEnds>1.5 && distance>lineLength-erodePx))) discard;
    if(!dashOn(style.y>1.5 ? 3 : 0,distance)) discard;
  }
  if(style.y>1.5 && style.y<2.5 && showAux<.5) discard;
  if(layerMode<.5 && style.z>.5) discard;
  if(layerMode>.5 && backFacing!=backPlan) discard;
  if(layerMode>1.5 && coveredByLayer()) discard;
  color=style.y>2.5 ? vec4(.65,.22,.50,1.) :
    style.y>1.5 ? vec4(auxColor,1.) :
    style.y>.5 ? vec4(edgeColor,1.) :
    vec4(gl_FrontFacing?frontColor:backColor,1.);
}`;

export interface CameraSpreadSurface {
  /** CSS dimensions and display DPR are distinct from the supersample ratio. */
  width: number;
  height: number;
  dpr: number;
  style?: RenderSettings;
}

export function createCameraRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mesh: CameraSpreadLift,
  kernel: OristudioCpFoldedPaperScene,
  plans: CameraPaintPlans
) {
  // Fragment-centre coverage and raster coverage must agree at folds and ink.
  // Supersample display pixels instead of mixing these tests with MSAA.
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL2 is unavailable for the camera spread view');
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
    const wire: number[] = [];
    const line = (
      a: number[],
      b: number[],
      rank: number,
      ink: number,
      patch: number,
      plane: number[],
      face: number,
      whole = { points: [a, b], onBoundary: [false, false] }
    ) => {
      for (const [end, sign] of [
        [0, 1],
        [1, -1],
        [0, -1],
        [0, -1],
        [1, -1],
        [1, 1],
      ])
        (ink === 3 ? wire : data).push(
          ...(end === 0 ? a : b),
          ...(end === 0 ? b : a),
          sign!,
          rank,
          ink,
          patch,
          ...plane,
          face,
          ...whole.points[0]!,
          ...whole.points[1]!,
          Number(whole.onBoundary[0]) + 2 * Number(whole.onBoundary[1])
        );
    };
    for (const piece of plan.pieces) {
      const { rank, points, face, plane } = piece;
      const patch = Number(piece.patch);
      if (piece.kind === 'line') {
        line(points[0]!, points[1]!, rank, piece.role === 'aux' ? 2 : 1, patch, plane, face, piece.whole);
      } else {
        const [a, b, c] = points;
        const cross = (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0]);
        const ordered = cross < 0 !== kernel.faces[face]!.front_up ? [a!, c!, b!] : points;
        for (const p of ordered) data.push(...p, 0, 0, 0, 0, rank, 0, patch, ...plane, face, 0, 0, 0, 0, 0, 0, 0);
        // Overlay remains in its face's depth slot, beneath every covering face.
        for (let i = 0; i < 3; i++) line(points[i]!, points[(i + 1) % 3]!, rank, 3, patch, plane, face);
      }
    }
    const b = gl.createBuffer();
    if (!b) throw new Error('Could not allocate camera buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const wireBuffer = gl.createBuffer();
    if (!wireBuffer) throw new Error('Could not allocate bending mesh buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, wireBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wire), gl.STATIC_DRAW);
    return { buffer: b, wireBuffer, wireCount: wire.length / 22, count: data.length / 22, slots: plan.slots };
  };
  const buffers = [buffer(plans.front), buffer(plans.back)];
  const attributes = ['position', 'other', 'side', 'paint', 'plane', 'faceId', 'wholeA', 'wholeB', 'boundary'].map(
    (name) => gl.getAttribLocation(program, name)
  );
  const bind = (index: number, wire = false) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, wire ? buffers[index]!.wireBuffer : buffers[index]!.buffer);
    [3, 3, 1, 3, 4, 1, 3, 3, 1].forEach((size, i) => {
      gl.enableVertexAttribArray(attributes[i]!);
      gl.vertexAttribPointer(attributes[i]!, size, gl.FLOAT, false, 88, [0, 12, 24, 28, 40, 56, 60, 72, 84][i]!);
    });
  };
  const locations = new Map<string, WebGLUniformLocation | null>();
  const location = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name)!;
  };
  const uniform = (name: string, value: number) => gl.uniform1f(location(name), value);
  const limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const xs = mesh.xy.map((p) => p.x),
    ys = mesh.xy.map((p) => p.y);
  const centre: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  gl.uniform2f(location('centre'), ...centre);
  const occlusion = createCameraOcclusion(gl, program, plans, cameraLayerRelations(kernel), centre);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  return {
    draw(
      options: CameraSpreadOptions,
      zoom = 1,
      showWire = false,
      pan: [number, number] = [0, 0],
      surface?: CameraSpreadSurface
    ) {
      // Two samples per axis on standard/Retina displays. A fixed 2x CSS
      // buffer is only native resolution on Retina, leaving hard raster edges.
      // Bound GPU work to 4x CSS resolution when display scaling exceeds 2x.
      if (gl.isContextLost()) throw new Error('The camera graphics context was lost; retry the live view');
      const displayDpr = surface?.dpr ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
      const renderScale = 2 * Math.min(2, Math.max(1, displayDpr));
      const width = Math.max(
          1,
          Math.round((surface?.width ?? (canvas as HTMLCanvasElement).clientWidth) * renderScale)
        ),
        height = Math.max(1, Math.round((surface?.height ?? (canvas as HTMLCanvasElement).clientHeight) * renderScale));
      if (width > limit || height > limit || width * height > 48_000_000)
        throw new Error('The camera viewport exceeds GPU capacity');
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      const style = surface?.style;
      gl.clearColor(...(style?.background ?? ([1, 1, 1] as const)), style?.backgroundAlpha ?? 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const frame = cameraSpreadTransform(options);
      uniform('amount', options.amount);
      uniform('inkScale', style ? renderScale / displayDpr : renderScale);
      gl.uniform2f(location('inkWidths'), style?.edgeWidthPx ?? 1.1, style?.auxWidthPx ?? 0.65);
      gl.uniform3fv(location('frontColor'), style?.frontColor ?? [1, 0.89, 0.46]);
      gl.uniform3fv(location('backColor'), style?.backColor ?? [0.88, 0.9, 0.92]);
      gl.uniform3fv(location('edgeColor'), style?.borderColor ?? [0.12, 0.14, 0.18]);
      gl.uniform3fv(location('auxColor'), style?.auxColor ?? [0.63, 0.65, 0.68]);
      uniform('showAux', Number(style?.showAux ?? true));
      uniform('showEdges', Number(style?.showEdges ?? true));
      uniform('erodePx', (((style?.erode ?? 0) * kernel.sheet) / mesh.size) * height * 0.5 * 1.45 * zoom);
      const { runs, counts } = packCreaseDash(style?.creaseDash);
      for (let i = 0; i < runs.length; i++) runs[i]! *= renderScale / displayDpr;
      gl.uniform1fv(location('dashRuns'), runs);
      gl.uniform1iv(location('dashCounts'), counts);
      gl.uniformMatrix3fv(location('camera'), false, transposeMat3(frame));
      uniform('mode', ['diagram', 'orthographic', 'perspective'].indexOf(options.projection));
      uniform('aspect', canvas.width / canvas.height);
      uniform('zoom', 1.45 * zoom);
      const layers = cameraSpreadVisibilityMode(options) === 'layers';
      if (layers && options.amount > 0) occlusion.update(options, frame, width, height, 1.45 * zoom, pan);
      uniform('layerMode', layers ? (options.amount > 0 ? 2 : 1) : 0);
      uniform('slots', plans.front.slots);
      uniform('showWire', Number(showWire));
      gl.uniform2f(location('pixels'), canvas.width / 2, canvas.height / 2);
      gl.uniform2f(location('pan'), pan[0], pan[1]);
      const drawPlan = (index: number) => {
        uniform('slots', buffers[index]!.slots);
        uniform('backPlan', index);
        bind(index);
        gl.drawArrays(gl.TRIANGLES, 0, buffers[index]!.count);
        if (showWire) {
          bind(index, true);
          gl.drawArrays(gl.TRIANGLES, 0, buffers[index]!.wireCount);
        }
      };
      if (layers) {
        drawPlan(0);
        if (options.projection !== 'diagram') drawPlan(1);
      } else drawPlan(frame[8] >= 0 ? 0 : 1);
    },
    dispose(loseContext = false) {
      buffers.forEach((b) => {
        gl.deleteBuffer(b.buffer);
        gl.deleteBuffer(b.wireBuffer);
      });
      occlusion.dispose();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

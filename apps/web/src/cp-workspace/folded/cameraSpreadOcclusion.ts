/** Screen-tiled coverage of authoritative layers; the depth buffer resolves all other overlaps. */
import { triangleTouchesTile } from './cameraSpreadTiles';
import type { Mat3, Vec3 } from '@treemaker/origami-simulator';
import type { CameraLayerRelations } from './cameraSpreadRelations';
import { cameraPaintBackFacing, type CameraPaintPlans } from './cameraSpreadVisibility';
import type { CameraSpreadOptions } from './cameraSpreadScene';

const TILE = 32;
const WIDTH = 2048;

export const CAMERA_OCCLUSION_GLSL = `
uniform highp sampler2D coverGeometry;
uniform highp usampler2D coverTiles, coverIndices, layerRelations;
flat in float owner;
ivec2 packedAddress(uint i) { return ivec2(int(i%2048u),int(i/2048u)); }
float edgeSide(vec2 a, vec2 b, vec2 p) { return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x); }
bool coveredByLayer() {
  uvec2 range=texelFetch(coverTiles,ivec2(gl_FragCoord.xy)/32,0).rg;
  for(uint i=0u;i<range.y;i++) {
    uint triangle=texelFetch(coverIndices,packedAddress(range.x+i),0).r;
    vec4 tail=texelFetch(coverGeometry,packedAddress(2u*triangle+1u),0);
    bool back=tail.z<0.;
    if(back!=(backFacing>.5)) continue;
    int face=int(abs(tail.z)) - 1;
    uint relation=texelFetch(layerRelations,ivec2(face,int(owner)),0).r;
    if(relation==3u ? tail.w<=style.x : relation!=(back?2u:1u)) continue;
    vec4 head=texelFetch(coverGeometry,packedAddress(2u*triangle),0);
    vec2 p=gl_FragCoord.xy;
    float a=edgeSide(head.xy,head.zw,p), b=edgeSide(head.zw,tail.xy,p), c=edgeSide(tail.xy,head.xy,p);
    // Include shared edges so a lower layer cannot leak through triangle seams.
    if(min(a,min(b,c))>=-0.00001 || max(a,max(b,c))<=0.00001) return true;
  }
  return false;
}
`;

export function createCameraOcclusion(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  plans: CameraPaintPlans,
  relations: CameraLayerRelations,
  centre: [number, number]
) {
  const textures = ['coverGeometry', 'coverTiles', 'coverIndices', 'layerRelations'].map((name, i) => {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not allocate camera coverage texture');
    gl.activeTexture(gl.TEXTURE0 + i + 2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, name), i + 2);
    return texture;
  });
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (relations.count > maxTexture) throw new Error('Camera layer relation texture exceeds GPU capacity');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8UI,
    relations.count,
    relations.count,
    0,
    gl.RED_INTEGER,
    gl.UNSIGNED_BYTE,
    relations.data
  );
  const sources = [plans.front, plans.back].map((plan) => plan.pieces.filter((p) => p.kind === 'face').reverse());
  let lastKey = '';
  const sizes: string[] = [];
  let bins: number[][] = [];
  let spans = new Uint32Array(0);
  let ids = new Uint32Array(0);
  const capacity = sources.reduce((n, pieces) => n + pieces.length, 0);
  const triangles = new Float32Array(WIDTH * 4 * Math.max(1, Math.ceil((capacity * 8) / (WIDTH * 4))));
  function upload(
    index: number,
    w: number,
    h: number,
    internal: number,
    format: number,
    type: number,
    data: Float32Array | Uint32Array
  ) {
    if (h > maxTexture) throw new Error('Camera coverage index exceeds GPU capacity');
    gl.activeTexture(gl.TEXTURE0 + index + 2);
    gl.bindTexture(gl.TEXTURE_2D, textures[index]!);
    const size = `${w},${h}`;
    if (sizes[index] === size) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, data);
    else {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
      sizes[index] = size;
    }
  }
  // Every active sampler must have complete storage, including zero-depth/raw draws.
  upload(0, 1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array(4));
  upload(1, 1, 1, gl.RG32UI, gl.RG_INTEGER, gl.UNSIGNED_INT, new Uint32Array(2));
  upload(2, 1, 1, gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array(1));
  return {
    update(
      options: CameraSpreadOptions,
      frame: Mat3,
      width: number,
      height: number,
      zoom: number,
      pan: [number, number]
    ) {
      const key = JSON.stringify([options.amount, options.projection, frame, width, height, zoom, pan]);
      if (key === lastKey) return;
      const columns = Math.ceil(width / TILE),
        rows = Math.ceil(height / TILE);
      if (bins.length !== columns * rows) {
        bins = Array.from({ length: columns * rows }, () => [] as number[]);
        spans = new Uint32Array(bins.length * 2);
      } else for (const bin of bins) bin.length = 0;
      let triangleCount = 0;
      const project = ([x, y, h]: Vec3, out: [number, number]) => {
        const px = x - centre[0],
          py = y - centre[1],
          z = h * options.amount;
        const depth = frame[6] * px + frame[7] * py + frame[8] * z;
        const w = options.projection === 'perspective' ? (2.5 - depth) / 2.5 : 1;
        out[0] = width / 2 + (((frame[0] * px + frame[1] * py + frame[2] * z) / w + pan[0]) * zoom * height) / 2;
        out[1] = height / 2 - (((frame[3] * px + frame[4] * py + frame[5] * z) / w + pan[1]) * zoom * height) / 2;
      };
      const a: [number,number]=[0,0], b: [number,number]=[0,0], c: [number,number]=[0,0];
      sources.forEach((pieces, side) => {
        for (const piece of pieces) {
          if (cameraPaintBackFacing(piece.plane, options, frame, centre) !== !!side) continue;
          project(piece.points[0]!,a); project(piece.points[1]!,b); project(piece.points[2]!,c);
          const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          if (Math.abs(area) < 1e-8) continue;
          const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) / TILE));
          const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) / TILE));
          const x1 = Math.min(columns - 1, Math.floor(Math.max(a[0], b[0], c[0]) / TILE));
          const y1 = Math.min(rows - 1, Math.floor(Math.max(a[1], b[1], c[1]) / TILE));
          if (x0 > x1 || y0 > y1) continue;
          const id = triangleCount++;
          const offset=id*8;
          triangles[offset]=a[0]; triangles[offset+1]=a[1];
          triangles[offset+2]=b[0]; triangles[offset+3]=b[1];
          triangles[offset+4]=c[0]; triangles[offset+5]=c[1];
          triangles[offset+6]=(piece.face+1)*(side?-1:1); triangles[offset+7]=piece.rank;
          for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
              // Skinny crease triangles touch a tiny fraction of their bounding box.
              // Reject those empty tiles before the fragment shader scans them.
              if (triangleTouchesTile(a, b, c, x * TILE, y * TILE, TILE)) bins[y * columns + x]!.push(id);
            }
        }
      });
      let entries = 0;
      bins.forEach((bin, i) => {
        spans[2 * i] = entries;
        spans[2 * i + 1] = bin.length;
        entries += bin.length;
      });
      const needed = WIDTH * Math.max(1, Math.ceil(entries / WIDTH));
      if (ids.length < needed) ids = new Uint32Array(2 ** Math.ceil(Math.log2(needed)));
      bins.forEach((bin, i) => ids.set(bin, spans[2 * i]));
      upload(
        0,
        WIDTH,
        Math.max(1, Math.ceil((triangleCount * 8) / (WIDTH * 4))),
        gl.RGBA32F,
        gl.RGBA,
        gl.FLOAT,
        triangles
      );
      upload(1, columns, rows, gl.RG32UI, gl.RG_INTEGER, gl.UNSIGNED_INT, spans);
      upload(2, WIDTH, needed / WIDTH, gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, ids);
      lastKey = key;
    },
    dispose() {
      textures.forEach((texture) => gl.deleteTexture(texture));
    },
  };
}

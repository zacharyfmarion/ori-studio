import type createREGL from 'regl';
import type { ViewTransform, Viewport } from '../types';
import { disposeOnce } from './disposeOnce';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;
type Texture = ReturnType<Regl['texture']>;

/**
 * Textured-quad program for reference images (the superset image layer). Each
 * image is one quad drawn in crease-pattern *model* coordinates:
 *
 *   modelPoint = center + R(rotation) * (corner * size)
 *   devicePoint = origin + modelPoint.x * ex + modelPoint.y * ey
 *
 * so it shares the exact model→device affine the creases use and tracks pan/zoom
 * for free. The crop rect remaps UVs into the source; opacity multiplies the
 * sampled alpha. Premultiplied-alpha output + blend matches the fill program, so
 * transparent PNGs composite without fringing.
 *
 * Images are low-count, so each is its own draw call (no instancing/batching).
 */
const VERT = `
precision highp float;
attribute vec2 corner;      // unit quad corner in [-0.5, 0.5]
uniform vec2 u_center;      // model coords
uniform vec2 u_halfSize;    // model units (width/2, height/2)
uniform vec2 u_rot;         // (cos, sin) of rotation
uniform vec4 u_crop;        // xy = crop origin, zw = crop size (0..1)
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
varying vec2 vUv;
void main() {
  vec2 scaled = corner * (u_halfSize * 2.0);
  // Rotate in model space (u_rot = cos, sin).
  vec2 rotated = vec2(
    scaled.x * u_rot.x - scaled.y * u_rot.y,
    scaled.x * u_rot.y + scaled.y * u_rot.x
  );
  vec2 model = u_center + rotated;
  vec2 dev = u_origin + model.x * u_ex + model.y * u_ey;
  vec2 clip = vec2(dev.x / u_viewport.x * 2.0 - 1.0, 1.0 - dev.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  // corner in [-0.5,0.5] -> uv in [0,1]. The model's +Y runs downward (like the
  // texture's rows), so the top corner (corner.y = -0.5) maps to v = 0 and the
  // image renders upright — no V flip.
  vec2 cornerUv = corner + 0.5;
  vUv = u_crop.xy + cornerUv * u_crop.zw;
}`;

const FRAG = `
precision highp float;
uniform sampler2D u_tex;   // premultiplied-alpha texture
uniform float u_opacity;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(u_tex, vUv);
  gl_FragColor = tex * u_opacity;
}`;

/** One image ready to draw: its uploaded texture plus placement + style. */
export interface ImageDrawItem {
  texture: Texture;
  center: readonly [number, number];
  halfWidth: number;
  halfHeight: number;
  rotation: number;
  crop: readonly [number, number, number, number];
  opacity: number;
}

export interface ImageDrawProps {
  view: ViewTransform;
  viewport: Viewport;
  items: readonly ImageDrawItem[];
}

export interface ImageProgram {
  draw(props: ImageDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];

interface ImagePerDrawProps {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  centerArr: Vec2;
  halfSizeArr: Vec2;
  rotArr: Vec2;
  cropArr: [number, number, number, number];
  opacity: number;
  texture: Texture;
}

interface ImageUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_center: Vec2;
  u_halfSize: Vec2;
  u_rot: Vec2;
  u_crop: [number, number, number, number];
  u_opacity: number;
  u_tex: Texture;
}

interface ImageAttributes {
  corner: unknown;
}

// A unit quad (two triangles) reused for every image.
const QUAD_CORNERS = new Float32Array([
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
]);

export function createImageProgram(regl: Regl): ImageProgram {
  const cornerBuf: Buffer = regl.buffer(QUAD_CORNERS);

  const draw = regl<ImageUniforms, ImageAttributes, ImagePerDrawProps>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      corner: cornerBuf,
    },
    uniforms: {
      u_origin: (_ctx: unknown, props: ImagePerDrawProps) => props.originArr,
      u_ex: (_ctx: unknown, props: ImagePerDrawProps) => props.exArr,
      u_ey: (_ctx: unknown, props: ImagePerDrawProps) => props.eyArr,
      u_viewport: (_ctx: unknown, props: ImagePerDrawProps) => props.viewportArr,
      u_center: (_ctx: unknown, props: ImagePerDrawProps) => props.centerArr,
      u_halfSize: (_ctx: unknown, props: ImagePerDrawProps) => props.halfSizeArr,
      u_rot: (_ctx: unknown, props: ImagePerDrawProps) => props.rotArr,
      u_crop: (_ctx: unknown, props: ImagePerDrawProps) => props.cropArr,
      u_opacity: (_ctx: unknown, props: ImagePerDrawProps) => props.opacity,
      u_tex: (_ctx: unknown, props: ImagePerDrawProps) => props.texture,
    },
    blend: {
      enable: true,
      func: {
        srcRGB: 1,
        srcAlpha: 1,
        dstRGB: 'one minus src alpha',
        dstAlpha: 'one minus src alpha',
      },
    },
    depth: { enable: false },
    count: 6,
  });

  return {
    draw({ view, viewport, items }) {
      if (items.length === 0) return;
      for (const item of items) {
        draw({
          originArr: [view.origin[0], view.origin[1]],
          exArr: [view.ex[0], view.ex[1]],
          eyArr: [view.ey[0], view.ey[1]],
          viewportArr: [viewport.width, viewport.height],
          centerArr: [item.center[0], item.center[1]],
          halfSizeArr: [item.halfWidth, item.halfHeight],
          rotArr: [Math.cos(item.rotation), Math.sin(item.rotation)],
          cropArr: [item.crop[0], item.crop[1], item.crop[2], item.crop[3]],
          opacity: item.opacity,
          texture: item.texture,
        });
      }
    },
    dispose: disposeOnce(() => {
      cornerBuf.destroy();
    }),
  };
}

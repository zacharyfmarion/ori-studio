import type createREGL from 'regl';
import type { Rgba, ViewTransform, Viewport } from '../types';
import { disposeOnce } from './disposeOnce';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Check-suppression regions: a faint tint plus a hairline border, drawn as one
 * rotatable quad per region in crease-pattern *model* coordinates.
 *
 *   modelPoint = center + R(rotation) * (corner * size)
 *   devicePoint = origin + modelPoint.x * ex + modelPoint.y * ey
 *
 * — the same model→device affine the creases and images use, so a region tracks
 * pan/zoom for free and stays glued to the paper it annotates.
 *
 * **Why this is a GPU program and not a DOM box.** Every DOM overlay on this
 * surface sits above the whole WebGL canvas, so nothing drawn in DOM can be
 * behind a crease. A region has to read as *backdrop* — the creases it is meant
 * to quiet must draw over it, not under it — so it has to be here. Its chip and
 * its selection overlay stay in DOM, where the text and the pointer targets
 * belong.
 *
 * **Why the border is a fragment-shader band rather than a stroked outline.**
 * A stroked outline would need its own segment geometry rebuilt on every resize
 * and rotate. Instead the quad carries its own half-extents *in device pixels*
 * (computed in the vertex stage from the view basis, so a zoom needs no CPU
 * work), and the fragment stage reads the distance to the nearest edge from
 * them. That makes the border a constant screen width at every zoom — a border
 * that scaled with the model would be invisible on a zoomed-out region and a
 * slab on a zoomed-in one — and antialiases the rotated edges, which a raw quad
 * boundary cannot do.
 *
 * Output is premultiplied-alpha with the same blend as the image and fill
 * programs, so a region composites over the grid without fringing.
 *
 * Regions are low-count (one or two on a document), so each is its own draw
 * call — no instancing, matching the image layer.
 */
const VERT = `
precision highp float;
attribute vec2 corner;      // unit quad corner in [-0.5, 0.5]
uniform vec2 u_center;      // model coords
uniform vec2 u_halfSize;    // model units (width/2, height/2)
uniform vec2 u_rot;         // (cos, sin) of rotation
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
varying vec2 vLocalPx;      // device-px offset from the center, along the rect's own axes
varying vec2 vHalfPx;       // half-extents in device px, along those same axes
void main() {
  // The rect's own axes in model space, and where a unit step along each lands
  // in device space. Their lengths are the model unit -> device px scales the
  // fragment stage measures its distances in.
  vec2 axisU = vec2(u_rot.x, u_rot.y);
  vec2 axisV = vec2(-u_rot.y, u_rot.x);
  vec2 devU = axisU.x * u_ex + axisU.y * u_ey;
  vec2 devV = axisV.x * u_ex + axisV.y * u_ey;
  vec2 halfPx = vec2(length(devU) * u_halfSize.x, length(devV) * u_halfSize.y);

  // Grow the quad by one device pixel past the rect so the outer edge has room
  // to antialias; the guard keeps a degenerate (sub-pixel) region from dividing
  // by zero.
  vec2 grown = (halfPx + 1.0) / max(halfPx, vec2(1e-4));
  vec2 localCorner = corner * grown;

  vLocalPx = localCorner * 2.0 * halfPx;
  vHalfPx = halfPx;

  vec2 scaled = localCorner * (u_halfSize * 2.0);
  vec2 rotated = vec2(
    scaled.x * u_rot.x - scaled.y * u_rot.y,
    scaled.x * u_rot.y + scaled.y * u_rot.x
  );
  vec2 model = u_center + rotated;
  vec2 dev = u_origin + model.x * u_ex + model.y * u_ey;
  vec2 clip = vec2(dev.x / u_viewport.x * 2.0 - 1.0, 1.0 - dev.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform vec4 u_fill;        // straight-alpha fill colour
uniform vec4 u_border;      // straight-alpha border colour
uniform float u_borderPx;   // border width, device px
uniform float u_opacity;    // the region's own opacity
varying vec2 vLocalPx;
varying vec2 vHalfPx;
void main() {
  // Distance to the nearest edge in device px: positive inside, negative out.
  vec2 toEdge = vHalfPx - abs(vLocalPx);
  float edge = min(toEdge.x, toEdge.y);
  // Half-pixel coverage at the boundary is what antialiases the rotated edges.
  float coverage = clamp(edge + 0.5, 0.0, 1.0);
  float border = 1.0 - clamp(edge - u_borderPx + 0.5, 0.0, 1.0);
  vec4 fillPm = vec4(u_fill.rgb * u_fill.a, u_fill.a);
  vec4 borderPm = vec4(u_border.rgb * u_border.a, u_border.a);
  gl_FragColor = mix(fillPm, borderPm, border) * coverage * u_opacity;
}`;

/** One region ready to draw: its placement plus its own opacity. */
export interface RegionDrawItem {
  center: readonly [number, number];
  halfWidth: number;
  halfHeight: number;
  /** Radians, about the region's center — regions are rotatable like images. */
  rotation: number;
  opacity: number;
}

export interface RegionDrawProps {
  view: ViewTransform;
  viewport: Viewport;
  items: readonly RegionDrawItem[];
  /**
   * Interior tint, straight alpha. Shared by every region: the style is not
   * per-region. Expected to be far weaker than {@link RegionDrawProps.border} —
   * a region sits under creases the user is still editing, so the border is what
   * states its extent (see `REGION_FILL_ALPHA` in `reglRenderer`).
   */
  fill: Rgba;
  /** Border colour, straight alpha. */
  border: Rgba;
  /** Border width in device px (constant screen size). */
  borderWidthPx: number;
}

export interface RegionProgram {
  draw(props: RegionDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];
type Vec4 = [number, number, number, number];

interface RegionPerDrawProps {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  centerArr: Vec2;
  halfSizeArr: Vec2;
  rotArr: Vec2;
  fillArr: Vec4;
  borderArr: Vec4;
  borderPx: number;
  opacity: number;
}

interface RegionUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_center: Vec2;
  u_halfSize: Vec2;
  u_rot: Vec2;
  u_fill: Vec4;
  u_border: Vec4;
  u_borderPx: number;
  u_opacity: number;
}

interface RegionAttributes {
  corner: unknown;
}

// A unit quad (two triangles) reused for every region.
const QUAD_CORNERS = new Float32Array([
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
]);

export function createRegionProgram(regl: Regl): RegionProgram {
  const cornerBuf: Buffer = regl.buffer(QUAD_CORNERS);

  const draw = regl<RegionUniforms, RegionAttributes, RegionPerDrawProps>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      corner: cornerBuf,
    },
    uniforms: {
      u_origin: (_ctx: unknown, props: RegionPerDrawProps) => props.originArr,
      u_ex: (_ctx: unknown, props: RegionPerDrawProps) => props.exArr,
      u_ey: (_ctx: unknown, props: RegionPerDrawProps) => props.eyArr,
      u_viewport: (_ctx: unknown, props: RegionPerDrawProps) => props.viewportArr,
      u_center: (_ctx: unknown, props: RegionPerDrawProps) => props.centerArr,
      u_halfSize: (_ctx: unknown, props: RegionPerDrawProps) => props.halfSizeArr,
      u_rot: (_ctx: unknown, props: RegionPerDrawProps) => props.rotArr,
      u_fill: (_ctx: unknown, props: RegionPerDrawProps) => props.fillArr,
      u_border: (_ctx: unknown, props: RegionPerDrawProps) => props.borderArr,
      u_borderPx: (_ctx: unknown, props: RegionPerDrawProps) => props.borderPx,
      u_opacity: (_ctx: unknown, props: RegionPerDrawProps) => props.opacity,
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
    draw({ view, viewport, items, fill, border, borderWidthPx }) {
      if (items.length === 0) return;
      const fillArr: Vec4 = [fill[0], fill[1], fill[2], fill[3]];
      const borderArr: Vec4 = [border[0], border[1], border[2], border[3]];
      for (const item of items) {
        draw({
          originArr: [view.origin[0], view.origin[1]],
          exArr: [view.ex[0], view.ex[1]],
          eyArr: [view.ey[0], view.ey[1]],
          viewportArr: [viewport.width, viewport.height],
          centerArr: [item.center[0], item.center[1]],
          halfSizeArr: [item.halfWidth, item.halfHeight],
          rotArr: [Math.cos(item.rotation), Math.sin(item.rotation)],
          fillArr,
          borderArr,
          borderPx: borderWidthPx,
          opacity: item.opacity,
        });
      }
    },
    dispose: disposeOnce(() => {
      cornerBuf.destroy();
    }),
  };
}

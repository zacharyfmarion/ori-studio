import { describe, expect, it } from 'vitest';
import { renderMeshToSvg } from '../src/svgRenderer.js';
import { cameraUniforms, projectVertices } from '../src/webgl/camera.js';
import type { MeshTopology, RenderSettings } from '../src/webgl/meshRenderer.js';

/**
 * Two triangles at different heights off the sheet, so one is unambiguously
 * nearer the eye than the other and the painter's order is checkable.
 *
 * At the camera below (pitch -1, so the view is tilted well off top-down) the
 * near triangle sits at y = +1 and the far one at y = -1.
 */
const NEAR_TRIANGLE = [0, 1, 2] as const;
const FAR_TRIANGLE = [3, 4, 5] as const;

function positions(): Float32Array {
  return new Float32Array([
    // near triangle: y = +1
    -1, 1, -1, 1, 1, -1, 0, 1, 1,
    // far triangle: y = -1
    -1, -1, -1, 1, -1, -1, 0, -1, 1,
  ]);
}

/**
 * `edgeAssignments` uses the codes the edge shader reads: 0=B, 1=M, 2=V, 3=F.
 * One of each, plus a facet edge that must not be drawn.
 */
function topology(): MeshTopology {
  return {
    // The far triangle is deliberately wound the other way, so the paper's two
    // sides are both exercised — which is what a folded sheet actually contains.
    faceIndices: new Uint32Array([0, 1, 2, 3, 5, 4]),
    edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 0, 3, 4]),
    edgeAssignments: new Uint8Array([1, 2, 0, 3]),
    textureDim: 4,
  };
}

const SETTINGS: RenderSettings = {
  frontColor: [1, 0, 0],
  backColor: [0, 0, 1],
  mountainColor: [1, 1, 0],
  valleyColor: [0, 1, 1],
  borderColor: [1, 0, 1],
  lightDir: [0, 0, 1],
  background: [0.1, 0.1, 0.1],
  showFaces: true,
  showEdges: true,
  lighting: false,
  creaseWidthPx: 2,
  faceAlpha: 1,
};

const CAMERA = cameraUniforms({ yaw: 0, pitch: -1, zoom: 1 }, [0, 0, 0], 2, 400, 300);

function render(
  settings: Partial<RenderSettings> = {},
  options: Parameters<typeof renderMeshToSvg>[4] = {},
  geometry = positions()
) {
  return renderMeshToSvg(geometry, topology(), CAMERA, { ...SETTINGS, ...settings }, options);
}

/** Document order of the drawn elements, ignoring the wrapper and background. */
function drawOrder(svg: string): string[] {
  return svg.split('\n').filter((line) => /^\s*<(polygon|line)\b/u.test(line));
}

/**
 * A vertex's projected coordinates, formatted as the renderer writes them, so a
 * test can ask *which* vertices an element touches rather than matching on
 * colour. Uses the projection as its own oracle, which is the point: these
 * assertions are about what the serializer does with a projected point.
 */
function pointOf(vertex: number, geometry = positions()): [string, string] {
  const projected = projectVertices(geometry, CAMERA);
  return [projected.screen[vertex * 2]!.toFixed(2), projected.screen[vertex * 2 + 1]!.toFixed(2)];
}

/**
 * Whether an element names any of these vertices. Reads the numbers out rather
 * than matching a substring: a polygon writes `x,y` pairs but a line writes
 * `x1="" y1=""`, so a pair-form `includes` never matches a line and passes
 * vacuously — which it did.
 */
function touches(element: string, vertices: readonly number[]): boolean {
  const numbers = element.match(/-?\d+\.\d{2}/gu) ?? [];
  return vertices.some((vertex) => {
    const [x, y] = pointOf(vertex);
    // Adjacent, so a shared x against a different y is not counted as a hit.
    return numbers.some((value, index) => value === x && numbers[index + 1] === y);
  });
}

describe('rendering the folded mesh to SVG', () => {
  it('emits one polygon per triangle and one line per drawn crease', () => {
    const page = render();
    expect(page).not.toBeNull();
    const drawn = drawOrder(page!.svg);
    expect(drawn.filter((line) => line.includes('<polygon'))).toHaveLength(2);
    // Three of the four edges are drawn; the fourth is a facet edge.
    expect(drawn.filter((line) => line.includes('<line'))).toHaveLength(3);
  });

  it('skips facet edges, which are triangulation artifacts and not folds', () => {
    // The facet edge is the only crease on the far triangle (vertices 3 and 4),
    // so its absence shows as no line touching that triangle at all.
    const lines = drawOrder(render()!.svg).filter((line) => line.includes('<line'));
    expect(lines).toHaveLength(3);
    expect(lines.some((line) => touches(line, FAR_TRIANGLE))).toBe(false);
    expect(lines.every((line) => touches(line, NEAR_TRIANGLE))).toBe(true);
  });

  it('paints the far triangle before the near one', () => {
    // The painter's contract. Reversed, the model renders inside out. At this
    // camera the sheet at y = +1 is nearer the eye than the one at y = -1.
    const polygons = drawOrder(render({ showEdges: false })!.svg);
    expect(polygons).toHaveLength(2);
    expect(touches(polygons[0]!, FAR_TRIANGLE)).toBe(true);
    expect(touches(polygons[1]!, NEAR_TRIANGLE)).toBe(true);
  });

  it('puts a crease after the face it lies on, so it is not painted over', () => {
    const page = render();
    const drawn = drawOrder(page!.svg);
    const lastPolygon = drawn.reduce(
      (last, line, index) => (line.includes('<polygon') ? index : last),
      -1
    );
    // Every crease here belongs to the near triangle, which is the last face
    // drawn, so all three lines follow it.
    expect(drawn.slice(lastPolygon + 1).every((line) => line.includes('<line'))).toBe(true);
  });

  it('dashes each crease kind with the pattern it was given', () => {
    // The caller flattens its style choice into these arrays, so this renderer
    // never sees a style name — which is what stops three renderers from each
    // interpreting one differently.
    const page = render({
      creaseDash: { border: null, mountain: [10, 3, 3, 3], valley: [8, 8] },
    })!;
    const lines = drawOrder(page.svg).filter((line) => line.includes('<line'));

    const mountain = lines.find((line) => line.includes(hexOf(SETTINGS.mountainColor)))!;
    const valley = lines.find((line) => line.includes(hexOf(SETTINGS.valleyColor)))!;
    const border = lines.find((line) => line.includes(hexOf(SETTINGS.borderColor)))!;
    expect(mountain).toContain('stroke-dasharray="10.00 3.00 3.00 3.00"');
    expect(valley).toContain('stroke-dasharray="8.00 8.00"');
    // A paper boundary is not a fold, so it stays solid.
    expect(border).not.toContain('stroke-dasharray');
  });

  it('gives a dashed crease butt caps, overriding the group default', () => {
    // The group sets round caps, which extend every run by half the stroke width
    // at both ends — that closes the gaps in a dash-dot pattern.
    const page = render({ creaseDash: { border: null, mountain: [10, 3, 3, 3], valley: null } })!;
    const mountain = drawOrder(page.svg).find(
      (line) => line.includes('<line') && line.includes(hexOf(SETTINGS.mountainColor))
    )!;
    expect(mountain).toContain('stroke-linecap="butt"');
    const valley = drawOrder(page.svg).find(
      (line) => line.includes('<line') && line.includes(hexOf(SETTINGS.valleyColor))
    )!;
    expect(valley).not.toContain('stroke-linecap');
  });

  it('emits no dash attribute at all when nothing is dashed', () => {
    expect(render().svg).not.toContain('stroke-dasharray');
    expect(
      render({ creaseDash: { border: null, mountain: null, valley: null } })!.svg
    ).not.toContain('stroke-dasharray');
  });

  it('colours creases by assignment', () => {
    const svg = render().svg;
    expect(svg).toContain(hexOf(SETTINGS.mountainColor));
    expect(svg).toContain(hexOf(SETTINGS.valleyColor));
    expect(svg).toContain(hexOf(SETTINGS.borderColor));
  });

  it('honours showFaces and showEdges', () => {
    const facesOnly = drawOrder(render({ showEdges: false })!.svg);
    expect(facesOnly.every((line) => line.includes('<polygon'))).toBe(true);

    const edgesOnly = drawOrder(render({ showFaces: false })!.svg);
    expect(edgesOnly.every((line) => line.includes('<line'))).toBe(true);
    expect(edgesOnly).toHaveLength(3);

    expect(render({ showFaces: false, showEdges: false })).toBeNull();
  });

  it('occludes a hidden crease even when its own face is not painted', () => {
    // Faces off still walks the triangles, because that walk is what tells a
    // crease which layer it belongs to.
    const page = render({ showFaces: false });
    expect(drawOrder(page!.svg)).toHaveLength(3);
  });

  it('writes translucent faces without a seam stroke', () => {
    // A doubled stroke on every shared edge would read as a wireframe.
    const opaque = render().svg;
    expect(opaque).toMatch(/<polygon[^/]*stroke-width="0\.50"/u);

    const xray = render({ faceAlpha: 0.48 }).svg;
    expect(xray).toContain('fill-opacity="0.48"');
    expect(xray).toMatch(/<polygon[^/]*stroke="none"/u);
  });

  it('colours by strain when asked, matching the face shader’s ramp', () => {
    // Upstream's ramp: hue 0.7 (blue) relaxed, falling to 0 (red) at the clip.
    // A 10% strain against a 5% clip is past the clip, so fully red.
    const strain = new Float32Array([0, 0, 0, 0.1, 0.1, 0.1]);
    const polygons = drawOrder(
      render({ colorMode: 'strain', strainClip: 5, showEdges: false }, { strain })!.svg
    );
    const relaxed = polygons.find((line) => touches(line, NEAR_TRIANGLE))!;
    const strained = polygons.find((line) => touches(line, FAR_TRIANGLE))!;
    expect(strained).toContain('#ff0000');
    // hueToRgb(0.7) -> (0.2, 0, 1).
    expect(relaxed).toContain('#3300ff');
  });

  it('falls back to the paper two-tone when no strain was read', () => {
    // Rendering everything one flat colour would be worse than ignoring the mode.
    const fallback = render({ colorMode: 'strain' }, { strain: null })!.svg;
    expect(fallback).toContain(hexOf(SETTINGS.frontColor));
    expect(fallback).toContain(hexOf(SETTINGS.backColor));
  });

  it('honours a strain clip the user has moved', () => {
    // The clip is a render setting, which is why the backend reports raw strain
    // rather than colours -- a baked-in clip could not answer for this view.
    const strain = new Float32Array([0, 0, 0, 0.02, 0.02, 0.02]);
    const tight = render({ colorMode: 'strain', strainClip: 2 }, { strain })!.svg;
    const loose = render({ colorMode: 'strain', strainClip: 20 }, { strain })!.svg;
    expect(tight).not.toBe(loose);
  });

  it('drops degenerate triangles rather than emitting invisible polygons', () => {
    // A zero-area triangle is the signature of a solver NaN reaching the
    // renderer.
    const collapsed = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, -1, -1, -1, 1, -1, -1, 0, -1, 1]);
    const page = render({ showEdges: false }, {}, collapsed);
    expect(drawOrder(page!.svg).filter((line) => line.includes('<polygon'))).toHaveLength(1);
  });

  it('emits no NaN coordinate when the solve has blown up', () => {
    const blown = positions();
    blown[0] = Number.NaN;
    blown[4] = Number.POSITIVE_INFINITY;
    const page = render({}, {}, blown);
    expect(page).not.toBeNull();
    expect(page!.svg).not.toMatch(/NaN|Infinity/u);
    expect(Number.isFinite(page!.width)).toBe(true);
    expect(Number.isFinite(page!.height)).toBe(true);
  });

  it('crops the page to the artwork rather than the camera frame', () => {
    const page = render()!;
    // The model spans well under the 400x300 frame at this zoom, so a cropped
    // page is smaller than the viewport it was composed in.
    expect(page.width).toBeLessThan(CAMERA.width);
    expect(page.height).toBeLessThan(CAMERA.height);
    expect(page.svg).toContain(`width="${page.width.toFixed(2)}"`);
    expect(page.svg).toContain('viewBox="');
  });

  it('leaves room for the crease stroke, which straddles the artwork edge', () => {
    const thin = render({ creaseWidthPx: 1 })!;
    const thick = render({ creaseWidthPx: 40 })!;
    expect(thick.width).toBeGreaterThan(thin.width);
  });

  it('paints the background only when asked', () => {
    expect(render({}, { background: true })!.svg).toContain('<rect');
    expect(render({}, { background: false })!.svg).not.toContain('<rect');
  });

  it('carries the background alpha through, for a window over the crease pattern', () => {
    const svg = render({ backgroundAlpha: 0 }, { background: true })!.svg;
    expect(svg).toContain('fill-opacity="0.00"');
  });

  it('is a well-formed standalone document', () => {
    const svg = render()!.svg;
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('returns null for an empty model', () => {
    expect(
      renderMeshToSvg(
        new Float32Array(),
        { faceIndices: new Uint32Array(), edgeIndices: new Uint32Array(), edgeAssignments: new Uint8Array(), textureDim: 1 },
        CAMERA,
        SETTINGS
      )
    ).toBeNull();
  });

  it('projects orthographically when the caller draws through the canvas-2D path', () => {
    const perspective = render({}, { perspective: true })!;
    const orthographic = render({}, { perspective: false })!;
    expect(orthographic.svg).not.toBe(perspective.svg);
  });

  it('shades with lighting on and flat-fills with it off', () => {
    const lit = render({ lighting: true })!.svg;
    const flat = render({ lighting: false })!.svg;
    expect(flat).toContain(hexOf(SETTINGS.frontColor));
    expect(lit).not.toBe(flat);
  });
});

/** A 0..1 colour triple as the renderer writes it. */
function hexOf(color: readonly [number, number, number]): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

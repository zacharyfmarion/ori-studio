import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import { foldedFigureSvgBody, projectedFoldedFigureBounds } from './foldedFigureSvg';

const WHITE = { red: 255, green: 255, blue: 255, alpha: 255 };
const BLACK = { red: 0, green: 0, blue: 0, alpha: 255 };

function snapshot(primitives: OristudioCpFoldedRenderPrimitive[]): OristudioCpFoldedRenderSnapshot {
  return { schema_version: 1, fixture: null, pass: null, primitives };
}

/** Doubling projector, so page coordinates are visibly not model coordinates. */
const project = (point: { x: number; y: number }) => ({ x: point.x * 2, y: point.y * 2 });

describe('folded figure SVG', () => {
  it('maps a filled polygon to a polygon element in page coordinates', () => {
    const svg = foldedFigureSvgBody(
      snapshot([
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: {
            paint: { kind: 'color', color: WHITE },
            stroke: { kind: 'none' },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        },
      ]),
      { project, scale: 2 }
    );

    expect(svg).toContain('<polygon points="0.00,0.00 20.00,0.00 20.00,20.00"');
    expect(svg).toContain('fill="#ffffff"');
  });

  /** A filled polygon in `color`, so the seam rule can be read off one fill. */
  function filledPolygon(
    color: { red: number; green: number; blue: number; alpha: number }
  ): OristudioCpFoldedRenderPrimitive {
    return {
      sequence: 0,
      kind: 'fill_polygon',
      style: {
        paint: { kind: 'color', color },
        stroke: { kind: 'none' },
        antialias: 'default',
      },
      geometry: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    };
  }

  it('strokes an opaque fill in its own colour to close the antialiasing seam', () => {
    // Fills used to be written `stroke="none"`, which left a hairline crack
    // along every shared subface boundary in a vector editor; the simulator's
    // exporter closes it the same way.
    const svg = foldedFigureSvgBody(snapshot([filledPolygon(WHITE)]), { project, scale: 2 });

    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#ffffff" stroke-width="0.50"');
    expect(svg).not.toContain('stroke="none"');
  });

  it('leaves a translucent fill unstroked, or every shared edge would double up', () => {
    const svg = foldedFigureSvgBody(
      snapshot([filledPolygon({ red: 255, green: 255, blue: 255, alpha: 128 })]),
      { project, scale: 2 }
    );

    expect(svg).toContain('fill="#ffffff" fill-opacity="0.50" stroke="none"');
    expect(svg).not.toContain('stroke-width');
  });

  /** A stroked path, width 1.5, from the origin to (5, 5). */
  function strokedPath(): OristudioCpFoldedRenderPrimitive {
    return {
      sequence: 0,
      kind: 'stroke_path',
      style: {
        paint: { kind: 'color', color: BLACK },
        stroke: { kind: 'basic', width: 1.5, end_cap: 0, line_join: 0, miter_limit: 10 },
        antialias: 'default',
      },
      geometry: {
        kind: 'path',
        commands: [
          { command: 'move_to', point: { x: 0, y: 0 } },
          { command: 'line_to', point: { x: 5, y: 5 } },
          { command: 'close' },
        ],
      },
    };
  }

  it('maps a stroked path to a path element and keeps the stroke width in screen px', () => {
    const svg = foldedFigureSvgBody(snapshot([strokedPath()]), { project, scale: 2 });

    expect(svg).toContain('<path d="M 0.00 0.00 L 10.00 10.00 Z"');
    expect(svg).toContain('stroke="#000000"');
    // The kernel width is a screen-px width, which the canvas draws unscaled;
    // the export used to multiply it by the geometry scale (pinned "3.00").
    expect(svg).toContain('stroke-width="1.50"');
    expect(svg).toContain('fill="none"');
  });

  it('scales the stroke width by strokeScale, not by the geometry scale', () => {
    const svg = foldedFigureSvgBody(snapshot([strokedPath()]), {
      project,
      scale: 2,
      strokeScale: 4,
    });

    expect(svg).toContain('<path d="M 0.00 0.00 L 10.00 10.00 Z"');
    expect(svg).toContain('stroke-width="6.00"');
  });

  it('never exports a stroke thinner than the hairline floor', () => {
    const svg = foldedFigureSvgBody(snapshot([strokedPath()]), {
      project,
      scale: 2,
      strokeScale: 0.1,
    });

    expect(svg).toContain('stroke-width="0.40"');
  });

  it('emits a gradient def rather than collapsing to its start colour', () => {
    const svg = foldedFigureSvgBody(
      snapshot([
        {
          sequence: 0,
          kind: 'fill_rect',
          style: {
            paint: {
              kind: 'gradient',
              from: { x: 0, y: 0 },
              from_color: WHITE,
              to: { x: 10, y: 0 },
              to_color: BLACK,
              cyclic: false,
            },
            stroke: { kind: 'none' },
            antialias: 'default',
          },
          geometry: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 },
        },
      ]),
      { project, scale: 2, idPrefix: 'fig' }
    );

    expect(svg).toContain('<linearGradient id="fig-0"');
    // No seam stroke: a gradient has no single colour to stroke in.
    expect(svg).toContain('fill="url(#fig-0)" stroke="none"');
  });

  it('skips primitives with no paint', () => {
    const svg = foldedFigureSvgBody(
      snapshot([
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: { paint: { kind: 'none' }, stroke: { kind: 'none' }, antialias: 'default' },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        },
      ]),
      { project, scale: 1 }
    );

    expect(svg).toBe('');
  });

  it('measures projected bounds and ignores undrawn primitives', () => {
    const bounds = projectedFoldedFigureBounds(
      snapshot([
        {
          sequence: 0,
          kind: 'stroke_segment',
          style: {
            paint: { kind: 'color', color: BLACK },
            stroke: { kind: 'basic', width: 1, end_cap: 0, line_join: 0, miter_limit: 10 },
            antialias: 'default',
          },
          geometry: { kind: 'segment', from: { x: -5, y: 0 }, to: { x: 10, y: 4 } },
        },
        {
          sequence: 1,
          kind: 'fill_polygon',
          style: { paint: { kind: 'none' }, stroke: { kind: 'none' }, antialias: 'default' },
          geometry: { kind: 'polygon', points: [{ x: 1000, y: 1000 }] },
        },
      ]),
      project
    );

    expect(bounds).toEqual({ minX: -10, minY: 0, maxX: 20, maxY: 8 });
  });

  it('reports no bounds for an empty snapshot', () => {
    expect(projectedFoldedFigureBounds(snapshot([]), project)).toBeNull();
  });
});

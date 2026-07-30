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

  it('maps a stroked path to a path element and scales the stroke width', () => {
    const svg = foldedFigureSvgBody(
      snapshot([
        {
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
        },
      ]),
      { project, scale: 2 }
    );

    expect(svg).toContain('<path d="M 0.00 0.00 L 10.00 10.00 Z"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="3.00"');
    expect(svg).toContain('fill="none"');
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
    expect(svg).toContain('fill="url(#fig-0)"');
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

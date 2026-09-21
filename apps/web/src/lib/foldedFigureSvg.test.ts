import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import {
  shadowStepReach,
  shadowStepStrength,
  shadowSvgStroke,
} from '../cp-workspace/folded/foldedShadowProfile';
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

  describe('layer shadow', () => {
    /** A strip of paper with one casting edge along its top, 10 model units of reach. */
    const shadow = (): OristudioCpFoldedRenderPrimitive => ({
      sequence: 0,
      kind: 'fill_path',
      style: {
        paint: {
          kind: 'layer_shadow',
          width: 10,
          strength: 0.2,
          occluder_edges: [{ from: { x: 0, y: 0 }, to: { x: 40, y: 0 }, step: 1 }],
        },
        stroke: { kind: 'none' },
        antialias: 'default',
      },
      geometry: {
        kind: 'path',
        commands: [
          { command: 'move_to', point: { x: 0, y: 0 } },
          { command: 'line_to', point: { x: 40, y: 0 } },
          { command: 'line_to', point: { x: 40, y: 8 } },
          { command: 'line_to', point: { x: 0, y: 8 } },
          { command: 'close' },
        ],
      },
    });

    it('strokes and blurs the casting outline, clipped to the receiving paper', () => {
      const svg = foldedFigureSvgBody(snapshot([shadow()]), { project, scale: 2, idPrefix: 'fig' });
      const { strokeWidth, stdDeviation, opacity } = shadowSvgStroke(20, 0.2);

      expect(svg).toContain('<clipPath id="fig-0-paper"><path d="M 0.00 0.00 L 80.00 0.00 L 80.00 16.00 L 0.00 16.00 Z"/></clipPath>');
      expect(svg).toContain(`<feGaussianBlur stdDeviation="${stdDeviation.toFixed(2)}"/>`);
      expect(svg).toContain('<g clip-path="url(#fig-0-paper)"><path d="M 0.00 0.00 L 80.00 0.00"');
      expect(svg).toContain(`stroke-width="${strokeWidth.toFixed(2)}"`);
      expect(svg).toContain(`stroke-opacity="${opacity.toFixed(2)}"`);
      expect(svg).toContain('stroke-linecap="round"');
      expect(svg).toContain('filter="url(#fig-0-blur-1)"');
    });

    it('gives the blur a region wide enough to hold it', () => {
      const svg = foldedFigureSvgBody(snapshot([shadow()]), { project, scale: 2, idPrefix: 'fig' });
      const { strokeWidth, stdDeviation } = shadowSvgStroke(20, 0.2);
      const margin = strokeWidth / 2 + 3 * stdDeviation;

      expect(svg).toContain(
        `<filter id="fig-0-blur-1" filterUnits="userSpaceOnUse" x="${(-margin).toFixed(2)}" y="${(-margin).toFixed(2)}" width="${(80 + 2 * margin).toFixed(2)}" height="${(2 * margin).toFixed(2)}">`
      );
    });

    it('strokes a taller ledge wider and darker, on its own blur', () => {
      const primitive = shadow();
      if (primitive.style.paint.kind === 'layer_shadow') {
        primitive.style.paint.occluder_edges = [
          { from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, step: 1 },
          { from: { x: 20, y: 0 }, to: { x: 40, y: 0 }, step: 4 },
        ];
      }
      const svg = foldedFigureSvgBody(snapshot([primitive]), { project, scale: 2, idPrefix: 'fig' });
      const low = shadowSvgStroke(20, 0.2);
      const tall = shadowSvgStroke(20 * shadowStepReach(4), 0.2 * shadowStepStrength(4));

      expect(tall.strokeWidth).toBeGreaterThan(low.strokeWidth);
      expect(tall.opacity).toBeGreaterThan(low.opacity);
      expect(svg).toContain(`<path d="M 0.00 0.00 L 40.00 0.00" fill="none" stroke="#000000" stroke-opacity="${low.opacity.toFixed(2)}" stroke-width="${low.strokeWidth.toFixed(2)}"`);
      expect(svg).toContain(`<path d="M 40.00 0.00 L 80.00 0.00" fill="none" stroke="#000000" stroke-opacity="${tall.opacity.toFixed(2)}" stroke-width="${tall.strokeWidth.toFixed(2)}"`);
      expect(svg).toContain('filter="url(#fig-0-blur-4)"');
      expect(svg).toContain(`<filter id="fig-0-blur-4"`);
      expect(svg).toContain(`<feGaussianBlur stdDeviation="${tall.stdDeviation.toFixed(2)}"/>`);
    });

    it('counts the shadowed paper in the figure bounds', () => {
      expect(projectedFoldedFigureBounds(snapshot([shadow()]), project)).toEqual({
        minX: 0,
        minY: 0,
        maxX: 80,
        maxY: 16,
      });
    });

    it('draws nothing for a shadow with no casting edge', () => {
      const primitive = shadow();
      if (primitive.style.paint.kind === 'layer_shadow') primitive.style.paint.occluder_edges = [];

      expect(foldedFigureSvgBody(snapshot([primitive]), { project, scale: 2 })).toBe('');
    });
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

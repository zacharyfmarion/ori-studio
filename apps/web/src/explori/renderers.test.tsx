import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/queryResponse.json';
import { createExploriDocument, type ExploriDocument } from './document';
import { exploriCpVertices } from './foldExport';
import { ExploriGraphFigure } from './renderers';
import type { ExploriCp, ExploriGraph } from './types';

/**
 * The tree figure: a mirrored pattern's tree is framed about the pattern's
 * mirror, a pattern without one gets no line, leaves are told apart from
 * branch nodes, and without a paper to go by the drawn tree's lean steers the
 * result.
 */

const recorded = fixture.results[0] as unknown as { cp: ExploriCp; packing: ExploriCp; tree: ExploriGraph };
const tree = recorded.tree;
const SIZE = 300;

/** The recorded result with its pattern, so the figure has a mirror to find. */
const withPaper = { cp: recorded.cp, packing: recorded.packing, symmetry: 'book' as const };

function render(props: Partial<Parameters<typeof ExploriGraphFigure>[0]> = {}): Element {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<ExploriGraphFigure graph={tree} size={SIZE} {...props} />);
  return host;
}

/** A drawn tree: node positions by id, and parent→child edges. */
function drawn(nodes: [number, number][], edges: [number, number][]): ExploriDocument {
  const base = createExploriDocument();
  return {
    ...base,
    nodes: nodes.map(([x, y], id) => ({ id, loc: { x, y }, name: '' })),
    edges: edges.map(([u, v], index) => ({ id: index + 1, vertices: [u, v] as [number, number], length: 1 })),
  };
}

/** Mean vertical position of the node dots matching `selector`. SVG y grows downward. */
const mean = (view: Element, selector: string) => {
  const values = [...view.querySelectorAll(`${selector} .explori-graph-node__dot`)].map((dot) =>
    Number(dot.getAttribute('y1'))
  );
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

describe('ExploriGraphFigure', () => {
  it('draws a mirrored pattern about its mirror line, centred in the figure', () => {
    // The recorded pattern mirrors top to bottom, so the line runs across.
    const view = render(withPaper);
    const axis = view.querySelector('.explori-graph-axis');
    expect(axis).not.toBeNull();
    expect(Number(axis?.getAttribute('y1'))).toBeCloseTo(SIZE / 2, 6);
    expect(Number(axis?.getAttribute('y2'))).toBeCloseTo(SIZE / 2, 6);
    // The mirrored pairs sit above and below that line.
    const dots = [...view.querySelectorAll('.explori-graph-node__dot')].map((dot) => Number(dot.getAttribute('y1')));
    const off = dots.filter((cy) => Math.abs(cy - SIZE / 2) > 1);
    expect(off.length).toBeGreaterThan(0);
    for (const cy of off) expect(off.some((other) => Math.abs(other - (SIZE - cy)) < 1e-6)).toBe(true);
  });

  it('draws no line without a pattern to find a mirror in, nor for a pattern that has none', () => {
    expect(render().querySelector('.explori-graph-axis')).toBeNull();
    // The same pattern with one crease missing mirrors across nothing, whatever
    // database it claims to be from.
    const points = exploriCpVertices(recorded.cp);
    const victim = recorded.cp.edges.find(([a, b, type]) => {
      const x = (points[a][0] + points[b][0]) / 2;
      const y = (points[a][1] + points[b][1]) / 2;
      return (type === 'm' || type === 'v') && [x - 0.5, y - 0.5, x - y, x + y - 1].every((value) => Math.abs(value) > 0.02);
    });
    const broken: ExploriCp = { ...recorded.cp, edges: recorded.cp.edges.filter((edge) => edge !== victim) };
    expect(render({ ...withPaper, cp: broken }).querySelector('.explori-graph-axis')).toBeNull();
  });

  it('tells leaves from branch nodes, and draws every mark in screen pixels', () => {
    const view = render(withPaper);
    expect(view.querySelectorAll('.explori-graph-node--leaf')).toHaveLength(5);
    expect(view.querySelectorAll('.explori-graph-node--branch')).toHaveLength(2);
    // Every line — edges, the axis, and both parts of each node — is a
    // non-scaling stroke, so its width is the width it is on screen.
    const lines = [...view.querySelectorAll('line')];
    expect(lines.length).toBe(6 + 1 + 7 * 2);
    expect(lines.every((line) => line.getAttribute('vector-effect') === 'non-scaling-stroke')).toBe(true);
    // A node is a zero-length line: its round caps are the dot.
    for (const dot of view.querySelectorAll('.explori-graph-node__dot')) {
      expect(dot.getAttribute('x1')).toBe(dot.getAttribute('x2'));
      expect(dot.getAttribute('y1')).toBe(dot.getAttribute('y2'));
    }
  });

  it('turns a differently shaped result to lean the way the drawn tree leans', () => {
    // A symmetric five-flap star, not the result's shape, leaning up or down.
    // The lean is measured against the tree's own centre — its branch nodes —
    // not the picture's, which the bounding box moves. SVG y grows downward.
    const up = render({
      symmetry: 'book',
      query: drawn([[0, 0], [1, 1], [-1, 1], [0, 2], [0.5, 2.5], [-0.5, 2.5]], [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    });
    expect(mean(up, '.explori-graph-node--leaf')).toBeLessThan(mean(up, '.explori-graph-node--branch'));
    const down = render({
      symmetry: 'book',
      query: drawn([[0, 0], [1, -1], [-1, -1], [0, -2], [0.5, -2.5], [-0.5, -2.5]], [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    });
    expect(mean(down, '.explori-graph-node--leaf')).toBeGreaterThan(mean(down, '.explori-graph-node--branch'));
  });

  it('draws nothing for an empty tree', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<ExploriGraphFigure graph={{ nodes: [], edges: [] }} size={SIZE} />);
    expect(host.querySelector('svg')).toBeNull();
  });
});

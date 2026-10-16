import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderDefox } from './defoxRenderer.js';
const square = () => ({
  V: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  Vf: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  FV: [[0, 1, 2, 3]],
  EV: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
  FE: [[0, 1, 2, 3]],
  EF: [[0], [0], [0], [0]],
  Ff: [false],
  EA: ['B', 'B', 'B', 'B'],
  UV: [],
  FU: [[]],
  UA: [],
  Vc: [0, 0, 0, 0],
  VV: [
    [1, 3],
    [0, 2],
    [1, 3],
    [0, 2],
  ],
});
const step = () => ({ id: 1, fold_cp: square(), fold: square(), params: {}, lin: { S: [0] }, symbols: [] });
describe('pinned Defox renderer', () => {
  it('draws the first entry and exports its source CP', () => {
    const entries = renderDefox(JSON.stringify([step()]));
    expect(entries).toHaveLength(1);
    const first = entries[0]!;
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.cp).toContain('1 -200 -200 200 -200');
      expect(first.svg).toContain('polygon');
      expect(first.svg).not.toContain('NaN');
    }
  });
  it('isolates malformed neighbors and rejects invalid topology', () => {
    const bad = step();
    bad.fold.FV[0]![0] = 999;
    const entries = renderDefox(JSON.stringify([bad, step()]));
    expect(entries.map((e) => e.ok)).toEqual([false, true]);
  });
  it('does not interpret metadata as code or markup', () => {
    const entries = renderDefox(
      JSON.stringify([
        {
          ...step(),
          title: '<script>throw 1</script>',
          color: { face: { top: 'url(https://invalid.test/x)' } },
        },
      ]),
    );
    expect(entries[0]!.ok).toBe(true);
    if (entries[0]!.ok) expect(entries[0]!.svg).not.toContain('invalid.test');
  });
  it.runIf(Boolean(process.env.ORI_DEFOX_CORPUS))(
    'renders the external project without dropping a step',
    () => {
      const before = performance.now();
      const entries = renderDefox(readFileSync(process.env.ORI_DEFOX_CORPUS!, 'utf8'));
      expect(entries.filter((e) => !e.ok)).toEqual([]);
      console.info('Defox corpus', {
        steps: entries.length,
        ms: Math.round(performance.now() - before),
        svgBytes: entries.reduce((n, e) => n + (e.ok ? e.svg.length : 0), 0),
      });
    },
  );
});

it('keeps imported saved-view sources and pending statuses through the diagram reader', async () => {
  const { cpStep } = await import('../document/diagramSteps.fixtures');
  const { createDiagram, insertSteps } = await import('../document/diagramDocument');
  const { readDiagram, writeDiagram } = await import('../document/diagramFile');
  const base = cpStep('defox');
  if (base.source?.kind !== 'cp') throw new Error('fixture');
  const saved = {
    ...base,
    source: { ...base.source, render: { mode: 'defox' as const, snapshot: JSON.stringify(step()) } },
  };
  const pending = { ...cpStep('pending'), importStatus: 'pending' as const };
  const read = readDiagram(
    JSON.parse(JSON.stringify(writeDiagram(insertSteps(createDiagram(), [saved, pending], 0)))),
  );
  expect(read?.readOnly).toBe(false);
  expect(read?.document.steps[0]).toMatchObject({
    source: { render: { mode: 'defox', snapshot: JSON.stringify(step()) } },
  });
  expect(read?.document.steps[1]).toMatchObject({ importStatus: 'pending' });
});

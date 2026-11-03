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
/** A project as a file holds it. */
const saved = (steps: unknown[], indent?: number) => new TextEncoder().encode(JSON.stringify(steps, null, indent));
describe('pinned Defox renderer', () => {
  it('draws the first entry and exports its source CP', () => {
    const entries = renderDefox(saved([step()]));
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
    const entries = renderDefox(saved([bad, step()]));
    expect(entries.map((e) => e.ok)).toEqual([false, true]);
  });
  it('does not interpret metadata as code or markup', () => {
    const entries = renderDefox(
      saved([
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
      const entries = renderDefox(readFileSync(process.env.ORI_DEFOX_CORPUS!));
      expect(entries.filter((e) => !e.ok)).toEqual([]);
      console.info('Defox corpus', {
        steps: entries.length,
        ms: Math.round(performance.now() - before),
        svgBytes: entries.reduce((n, e) => n + (e.ok ? e.svg.length : 0), 0),
      });
    },
  );
});

describe('what a Defox import admits', () => {
  const MiB = 1024 * 1024;
  /** One file of `parts`, each text or bytes. */
  const file = (...parts: (string | Uint8Array)[]) => {
    const chunks = parts.map((part) => (typeof part === 'string' ? new TextEncoder().encode(part) : part));
    const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
    chunks.reduce((at, chunk) => (bytes.set(chunk, at), at + chunk.length), 0);
    return bytes;
  };
  it('reads a project by what it holds, not by its indentation', () => {
    const json = JSON.stringify([step()], null, 2);
    const entries = renderDefox(file(json.slice(0, -1), new Uint8Array(65 * MiB).fill(0x20), json.slice(-1)));
    expect(entries.map((e) => e.ok)).toEqual([true]);
  });
  it('refuses a project that holds more than 64 MiB', () => {
    const json = JSON.stringify([{ ...step(), title: '' }]);
    const at = json.indexOf('"title":"') + '"title":"'.length;
    const title = new Uint8Array(65 * MiB).fill(0x78);
    expect(() => renderDefox(file(json.slice(0, at), title, json.slice(at)))).toThrow(
      'Defox project holds more than 64 MiB',
    );
  });
  it('keeps what is inside strings', () => {
    const title = 'two  spaces, a "quote", 折り紙 and a closing backslash \\';
    const [entry] = renderDefox(saved([{ ...step(), title }], 2));
    expect(entry?.ok && JSON.parse(entry.snapshot).title).toBe(title);
  });
  it('refuses bytes that are not UTF-8', () => {
    expect(() => renderDefox(file('[{"title":"', new Uint8Array([0xff]), '"}]'))).toThrow(TypeError);
  });
  it("keeps a step's saved state without what Defox's layer solver derives from it", () => {
    // Past the per-step limit with them, a few kilobytes without.
    const faces = Array.from({ length: 150000 }, () => [0, 1, 2, 3]);
    const cells = { CF: faces, FC: faces, GA: [[[0]]], GI: [0] };
    const [entry] = renderDefox(saved([{ ...step(), cell_cp: cells, state_cp: [0], title: 'kept' }]));
    if (!entry?.ok) throw new Error(entry?.error);
    const kept = JSON.parse(entry.snapshot);
    expect(kept).toMatchObject({ fold: square(), lin: { S: [0] }, title: 'kept' });
    for (const key of ['fold_d', 'cell_cp', 'cell_d', 'state_cp', 'state']) expect(kept).not.toHaveProperty(key);
  });
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

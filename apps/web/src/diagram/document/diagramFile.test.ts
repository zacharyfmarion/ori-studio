import { describe, expect, it } from 'vitest';

import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  createDiagram,
  createStep,
  duplicateStep,
  insertSteps,
  setPageSetup,
  setStepText,
  type DiagramIdFactory,
} from './diagramDocument';
import { readDiagram, writeDiagram } from './diagramFile';

function sequentialIds(): DiagramIdFactory {
  let next = 0;
  return (prefix) => `${prefix}-${++next}`;
}

/** What `serializeNativeProjectFile` does to the value, and back. */
const throughJson = (value: unknown) => JSON.parse(JSON.stringify(value, null, 2));

function sampleDiagram() {
  const ids = sequentialIds();
  let diagram = createDiagram({ title: 'Crane · 千纸鹤', hanStyle: 'sc', newId: ids });
  diagram = insertSteps(diagram, [createStep(ids), createStep(ids)], 0);
  diagram = setStepText(diagram, diagram.steps[0].id, 'Fold the corner up.');
  diagram = setStepText(diagram, diagram.steps[1].id, '将底角向上折至顶角。');
  return setPageSetup(diagram, { layout: 'flow', columns: 4, pageNumbers: { enabled: true, first: 3 } });
}

describe('writeDiagram / readDiagram', () => {
  it('round-trips every field a Phase 1 diagram holds', () => {
    const diagram = sampleDiagram();
    const read = readDiagram(throughJson(writeDiagram(diagram)));
    expect(read).not.toBeNull();
    expect(read!.readOnly).toBe(false);
    expect(read!.document).toEqual(diagram);
  });

  it('round-trips a resolved paper style', () => {
    const diagram = { ...sampleDiagram(), style: { style: DEFAULT_PAPER_STYLE } };
    expect(readDiagram(throughJson(writeDiagram(diagram)))!.document.style).toEqual({
      style: DEFAULT_PAPER_STYLE,
    });
  });

  it('reads nothing that is not a diagram', () => {
    expect(readDiagram(null)).toBeNull();
    expect(readDiagram([])).toBeNull();
    expect(readDiagram('diagram')).toBeNull();
  });

  it('drops malformed steps and keeps the rest', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps.splice(1, 0, 'not a step', { text: 'no id' }, { ...written.steps[0] });
    const read = readDiagram(written)!;
    // The id-less step and the string are malformed; the repeated id is a copy.
    expect(read.document.steps.map((step) => step.text)).toEqual([
      'Fold the corner up.',
      '将底角向上折至顶角。',
    ]);
  });

  it('falls back field by field for damaged top-level fields', () => {
    const read = readDiagram(
      { id: 7, title: 9, hanStyle: 4, style: { preset: 5 }, page: 'big', steps: 'many' },
      sequentialIds()
    )!;
    // Wrong types are damage, not a newer build's news: still editable.
    expect(read.readOnly).toBe(false);
    expect(read.document).toMatchObject({
      id: 'diagram-1',
      title: '',
      hanStyle: 'sc',
      style: { preset: 'diagram' },
      steps: [],
    });
  });

  it('removes characters XML cannot hold from stored text', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.title = 'Crane\u0001';
    written.steps[0].text = 'Fold\u000C up';
    const read = readDiagram(written)!;
    expect(read.document.title).toBe('Crane');
    expect(read.document.steps[0].text).toBe('Fold up');
  });
});

describe('a newer build’s work', () => {
  it('carries a step whose source it cannot read, locked and verbatim', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    const newer = {
      ...written.steps[0],
      source: { kind: 'hologram', depth: 3 },
      picture: { kind: 'hologram-scene', data: 'abc' },
      futureField: [1, 2],
    };
    written.steps[0] = newer;
    const read = readDiagram(written)!;
    expect(read.document.steps[0].unknown).toEqual(newer);
    // Written back exactly as read.
    expect(throughJson(writeDiagram(read.document)).steps[0]).toEqual(newer);
  });

  it('carries annotations and assets it cannot read, verbatim', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    const annotation = { id: 'ann-1', kind: 'spiral-arrow', from: [0, 0], to: [1, 1] };
    const asset = { id: 'asset-1', kind: 'video', bytes: 3 };
    written.steps[1].annotations = [annotation, { kind: 'no id' }];
    written.assets = { 'asset-1': asset, broken: 'not an asset' };
    const read = readDiagram(written)!;
    expect(read.document.steps[1].unknown).toBeUndefined();
    expect(read.document.steps[1].annotations).toEqual([{ id: 'ann-1', unknown: annotation }]);
    const again = throughJson(writeDiagram(read.document));
    expect(again.steps[1].annotations).toEqual([annotation]);
    expect(again.assets).toEqual({ 'asset-1': asset });
  });

  it.each([
    ['a document key it does not know', { fonts: { han: 'sc' } }],
    ['a Han style it does not know', { hanStyle: 'vi' }],
    ['a preset it does not know', { style: { preset: 'future' } }],
    ['a page size it does not know', { page: { size: 'a3' } }],
    ['a page key it does not know', { page: { bleedMm: 3 } }],
  ])('opens read-only, and writes back unchanged, a diagram with %s', (_label, patch) => {
    const written = { ...throughJson(writeDiagram(sampleDiagram())), ...patch };
    if ('page' in patch) written.page = { ...throughJson(writeDiagram(sampleDiagram())).page, ...patch.page };
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(true);
    expect(writeDiagram(read.document, read.raw)).toBe(written);
  });

  it('gives a duplicated step’s carried annotations ids of their own in the file', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps[0].annotations = [{ id: 'ann-1', kind: 'spiral-arrow' }];
    const read = readDiagram(written)!;
    const copied = duplicateStep(read.document, read.document.steps[0].id, sequentialIds())!;
    const ids = throughJson(writeDiagram(copied.document)).steps.map(
      (step: { annotations: { id: string }[] }) => step.annotations.map((annotation) => annotation.id)
    );
    expect(ids[0]).toEqual(['ann-1']);
    // The copy's own id, in memory and in the file alike.
    expect(ids[1]).toEqual([copied.document.steps[1].annotations[0].id]);
    expect(ids[1]).not.toEqual(['ann-1']);
  });

  it('opens a newer format read-only and writes it back unchanged', () => {
    const written = { ...throughJson(writeDiagram(sampleDiagram())), formatVersion: 2, layers: [1] };
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(true);
    expect(read.document.steps).toHaveLength(2);
    expect(writeDiagram(read.document, read.raw)).toBe(written);
  });
});

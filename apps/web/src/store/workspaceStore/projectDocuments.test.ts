import { describe, expect, it } from 'vitest';
import { createDiagram } from '../../diagram/document/diagramDocument';
import { initialFoldReaderState, withFoldCursor } from '../../fold/document/foldReaderState';
import { FOLD_DEFAULT_PAPER_STYLE, FOLD_SEQUENCE_FORMAT_VERSION } from '../../fold/document/foldSequenceDocument';
import { readFoldSequences } from '../../fold/document/foldSequenceFile';
import { DIAGRAM_SCOPED_KEYS, discardDiagramState } from './diagramState';
import { FOLD_SCOPED_KEYS, discardFoldState, type FoldSequences } from './foldState';
import {
  discardProjectDocuments,
  hasProjectDocument,
  projectDocumentDataBytes,
  projectDocumentFileValues,
  projectDocumentLanding,
  projectDocumentViewState,
  projectDocumentsChangedSince,
  readProjectDocuments,
} from './projectDocuments';
import type { WorkspaceState } from './types';

/** The store as far as the registry reads it: each project document's scoped state, nothing else. */
const store = (patch: Partial<WorkspaceState> = {}) =>
  ({ ...discardDiagramState(), ...discardFoldState(), ...patch }) as WorkspaceState;

/** A sequence as a file holds it: two steps, the second a crease pattern Import CP embedded. */
const sequenceValue = {
  formatVersion: FOLD_SEQUENCE_FORMAT_VERSION,
  id: 'fold-1',
  title: 'Crane',
  paper: { shape: { kind: 'square' }, startSide: 'front' },
  style: FOLD_DEFAULT_PAPER_STYLE,
  steps: [
    { id: 'fstep-1', parent: null, op: { kind: 'turn', axis: 'vertical' } },
    { id: 'fstep-2', parent: 'fstep-1', op: { kind: 'cp-jump', cpJson: '[1,2,3]', orderJson: '[4]', origin: 'cp' } },
  ],
};

const sequences = (): FoldSequences => readFoldSequences([sequenceValue]);

/** The workspace of a file, as far as the registry reads it. */
const workspace = (patch: Record<string, unknown> = {}) =>
  ({ diagrams: [], foldSequences: null, viewState: {}, ...patch }) as never;

describe('the project-document registry', () => {
  it('discards every key scoped to each document, with a fresh load id', () => {
    const before = store();
    const discarded = discardProjectDocuments();
    for (const key of [...DIAGRAM_SCOPED_KEYS, ...FOLD_SCOPED_KEYS]) {
      if (key === 'diagramLoadId' || key === 'foldLoadId') continue;
      expect(discarded[key], key).toEqual(before[key]);
    }
    expect(discarded.diagramLoadId).not.toBe(before.diagramLoadId);
    expect(discarded.foldLoadId).not.toBe(before.foldLoadId);
  });

  it('finds nothing in a project without a document, and writes none', () => {
    expect(hasProjectDocument(store())).toBe(false);
    expect(projectDocumentLanding(store())).toBeNull();
    expect(projectDocumentFileValues(store())).toEqual({ diagrams: [], foldSequences: null });
    expect(projectDocumentViewState(store())).toEqual({});
    expect(projectDocumentDataBytes(store())).toBe(0);
  });

  it('finds a diagram, lands on it, and writes back a read-only one as it came', () => {
    const diagram = createDiagram();
    const raw = { formatVersion: 99, id: diagram.id };
    const state = store({ diagram, diagramReadOnly: true, diagramRaw: raw });

    expect(hasProjectDocument(state)).toBe(true);
    expect(projectDocumentLanding(state)).toBe('diagram');
    expect(projectDocumentFileValues(state)).toEqual({ diagrams: [raw], foldSequences: null });
  });

  it('writes the diagram shown first, then the project’s others as they came, and counts them', () => {
    const diagram = createDiagram();
    const other = { formatVersion: 1, id: 'diagram-2', steps: [] };
    const state = store({ diagram, diagramOthers: [other] });

    const written = projectDocumentFileValues(state).diagrams;
    expect(written.map((value) => value.id)).toEqual([diagram.id, 'diagram-2']);
    expect(written[1]).toBe(other);
    expect(projectDocumentDataBytes(state)).toBe(JSON.stringify(other).length);
  });

  it('finds fold sequences, lands in Fold, and writes them and where the reader was', () => {
    const held = sequences();
    const reader = withFoldCursor(initialFoldReaderState('fold-1'), held[0].document, 'fstep-2');
    const state = store({ foldSequences: held, foldReader: reader });

    expect(hasProjectDocument(state)).toBe(true);
    expect(projectDocumentLanding(state)).toBe('fold');
    expect(projectDocumentFileValues(state).foldSequences).toEqual([sequenceValue]);
    expect(projectDocumentViewState(state)).toEqual({
      fold: { v: 1, sequenceId: 'fold-1', cursor: 'fstep-2', activeChild: { '': 'fstep-1', 'fstep-1': 'fstep-2' } },
    });
    // The crease pattern and the order Import CP embeds are what make a file big.
    expect(projectDocumentDataBytes(state)).toBe('[1,2,3]'.length + '[4]'.length);
  });

  it('lands on the Diagram for a project holding both', () => {
    expect(projectDocumentLanding(store({ diagram: createDiagram(), foldSequences: sequences() }))).toBe('diagram');
  });

  it('tells a save whether a document changed while it was writing, and not the reader moving', () => {
    const written = store({ diagram: createDiagram(), foldSequences: sequences(), foldReader: initialFoldReaderState('fold-1') });
    // Anything else may change; an edit replaces the document, and that is what counts.
    expect(projectDocumentsChangedSince(written, { ...written, dirty: true })).toBe(false);
    expect(projectDocumentsChangedSince(written, { ...written, foldReader: { ...written.foldReader!, cursor: 'fstep-1' } })).toBe(false);
    expect(projectDocumentsChangedSince(written, { ...written, diagram: createDiagram() })).toBe(true);
    expect(projectDocumentsChangedSince(written, { ...written, diagram: null })).toBe(true);
    expect(projectDocumentsChangedSince(written, { ...written, foldSequences: sequences() })).toBe(true);
  });

  it('reads what a file carries, and installs it on demand', () => {
    const none = readProjectDocuments(workspace());
    expect(none.present).toBe(false);

    const installed: unknown[] = [];
    const get = () =>
      ({
        installDiagram: (read: unknown, others: unknown) => installed.push({ read, others }),
        installFoldSequences: (read: unknown, reader: unknown) => installed.push({ read, reader }),
      }) as unknown as WorkspaceState;
    const other = { id: 'diagram-2', steps: [] };
    const some = readProjectDocuments(workspace({ diagrams: [{ id: 'diagram-1', steps: [] }, other] }));
    expect(some.present).toBe(true);
    expect(installed).toEqual([]);
    some.install(get);
    // The first diagram is shown; the rest are carried as they came.
    expect(installed).toEqual([
      {
        read: expect.objectContaining({ readOnly: false, document: expect.objectContaining({ id: 'diagram-1' }) }),
        others: [other],
      },
      { read: [], reader: null },
    ]);
  });

  it('reads fold sequences and the reader state beside them', () => {
    const installed: { read: FoldSequences; reader: unknown }[] = [];
    const get = () =>
      ({
        installDiagram: () => undefined,
        installFoldSequences: (read: FoldSequences, reader: unknown) => installed.push({ read, reader }),
      }) as unknown as WorkspaceState;
    const reader = { v: 1, sequenceId: 'fold-1', cursor: 'fstep-1', activeChild: {} };

    const read = readProjectDocuments(workspace({ foldSequences: [sequenceValue], viewState: { fold: reader } }));
    expect(read.present).toBe(true);
    read.install(get);

    expect(installed[0].read.map((held) => held.document.id)).toEqual(['fold-1']);
    expect(installed[0].reader).toEqual(reader);
  });
});

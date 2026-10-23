import { describe, expect, it } from 'vitest';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { DiagramDocument } from '../../diagram/document/diagramDocument';
import { createDiagram } from '../../diagram/document/diagramDocument';
import { createFoldSequence } from '../../fold/document/foldSequenceDocument';
import type { DesignTab } from './designTabs';
import type { FoldSequences } from './foldState';
import { landingWorkspace } from './landingWorkspace';

const cpDocument = {} as OristudioCpDocumentState;
const importedDocument = {} as ImportedCreasePatternDocument;
const diagram: DiagramDocument = createDiagram();
const foldSequences: FoldSequences = [{ document: createFoldSequence(), readOnlyRaw: null }];
const chooser = { kind: null } as DesignTab;
const design = { kind: 'treemaker' } as DesignTab;
/** Nothing but what a test names. */
const base = { designTabs: [chooser], diagram: null, foldSequences: [] };

describe('landingWorkspace', () => {
  it('lands in Edit when the open produced an editable crease pattern', () => {
    expect(
      landingWorkspace({ ...base, oristudioCpDocument: cpDocument, importedCreasePattern: null })
    ).toBe('edit');
  });

  it('lands in Edit for an imported crease pattern with no editable document', () => {
    expect(
      landingWorkspace({ ...base, oristudioCpDocument: null, importedCreasePattern: importedDocument })
    ).toBe('edit');
  });

  it('lands in Design when the open produced no crease pattern', () => {
    expect(landingWorkspace({ ...base, oristudioCpDocument: null, importedCreasePattern: null })).toBe(
      'design'
    );
  });

  it('lands in Edit for a design bundled with a crease-pattern companion', () => {
    // The `.osf` case behind the bug: a box-pleat design and an Edit crease
    // pattern in one file. The design decides which document the loader treats
    // as primary; it must not also decide which workspace opens.
    expect(
      landingWorkspace({ ...base, oristudioCpDocument: cpDocument, importedCreasePattern: importedDocument })
    ).toBe('edit');
  });

  it('lands in Diagram for a project that is only a diagram', () => {
    expect(
      landingWorkspace({ ...base, oristudioCpDocument: null, importedCreasePattern: null, diagram })
    ).toBe('diagram');
  });

  it('lands where it always did when the diagram has company', () => {
    expect(
      landingWorkspace({ ...base, oristudioCpDocument: cpDocument, importedCreasePattern: null, designTabs: [chooser], diagram })
    ).toBe('edit');
    expect(
      landingWorkspace({ ...base, oristudioCpDocument: null, importedCreasePattern: null, designTabs: [design], diagram })
    ).toBe('design');
  });

  it('lands in Fold for a project that is only fold sequences', () => {
    expect(
      landingWorkspace({ ...base, oristudioCpDocument: null, importedCreasePattern: null, foldSequences })
    ).toBe('fold');
  });

  it('opens a linked Collapse sequence in Fold while retaining its companion CP', () => {
    const sequence = createFoldSequence();
    sequence.steps = [{ id: 'collapse', parent: null, op: { kind: 'cp-jump', origin: 'project_cp',
      cpJson: '{}', orderJson: '[]', source: { documentId: 'crease-pattern', revision: 'saved' } } }];
    const linked = { ...base, oristudioCpDocument: cpDocument, importedCreasePattern: null,
      foldSequences: [{ document: sequence, readOnlyRaw: null }] };
    expect(landingWorkspace(linked)).toBe('fold');
    expect(landingWorkspace({ ...linked, designTabs: [design] })).toBe('edit');
    expect(landingWorkspace({ ...linked, diagram })).toBe('edit');
  });

  it('lands in the Diagram for a project of a diagram and fold sequences, and where it always did beside a design', () => {
    const nothingElse = { ...base, oristudioCpDocument: null, importedCreasePattern: null };
    expect(landingWorkspace({ ...nothingElse, diagram, foldSequences })).toBe('diagram');
    expect(landingWorkspace({ ...nothingElse, designTabs: [design], foldSequences })).toBe('design');
    expect(landingWorkspace({ ...nothingElse, oristudioCpDocument: cpDocument, foldSequences })).toBe('edit');
  });
});

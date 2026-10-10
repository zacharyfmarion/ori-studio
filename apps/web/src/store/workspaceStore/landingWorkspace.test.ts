import { describe, expect, it } from 'vitest';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { DiagramDocument } from '../../diagram/document/diagramDocument';
import { createDiagram } from '../../diagram/document/diagramDocument';
import type { DesignTab } from './designTabs';
import { landingWorkspace } from './landingWorkspace';

const cpDocument = {} as OristudioCpDocumentState;
const importedDocument = {} as ImportedCreasePatternDocument;
const diagram: DiagramDocument = createDiagram();
const chooser = { kind: null } as DesignTab;
const design = { kind: 'treemaker' } as DesignTab;
/** Nothing but what a test names. */
const base = { designTabs: [chooser], diagram: null };

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
      landingWorkspace({ oristudioCpDocument: cpDocument, importedCreasePattern: null, designTabs: [chooser], diagram })
    ).toBe('edit');
    expect(
      landingWorkspace({ oristudioCpDocument: null, importedCreasePattern: null, designTabs: [design], diagram })
    ).toBe('design');
  });
});

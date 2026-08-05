import { describe, expect, it } from 'vitest';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { landingWorkspace } from './landingWorkspace';

const cpDocument = {} as OristudioCpDocumentState;
const importedDocument = {} as ImportedCreasePatternDocument;

describe('landingWorkspace', () => {
  it('lands in Edit when the open produced an editable crease pattern', () => {
    expect(
      landingWorkspace({ oristudioCpDocument: cpDocument, importedCreasePattern: null })
    ).toBe('edit');
  });

  it('lands in Edit for an imported crease pattern with no editable document', () => {
    expect(
      landingWorkspace({ oristudioCpDocument: null, importedCreasePattern: importedDocument })
    ).toBe('edit');
  });

  it('lands in Design when the open produced no crease pattern', () => {
    expect(landingWorkspace({ oristudioCpDocument: null, importedCreasePattern: null })).toBe(
      'design'
    );
  });

  it('lands in Edit for a design bundled with a crease-pattern companion', () => {
    // The `.osf` case behind the bug: a box-pleat design and an Edit crease
    // pattern in one file. The design decides which document the loader treats
    // as primary; it must not also decide which workspace opens.
    expect(
      landingWorkspace({ oristudioCpDocument: cpDocument, importedCreasePattern: importedDocument })
    ).toBe('edit');
  });
});

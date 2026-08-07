import { describe, expect, it } from 'vitest';
import type { OristudioBpDocumentState } from '../../engine/oristudioBpTypes';
import { bpSheetCanSubdivide, bpSheetCanUnsubdivide } from './bpSheetCapabilities';

const sheet = { kind: 'rectangular' as const, width: 16, height: 16, grid: { kind: 'rectangular' as const, interval: 1, snap: true } };

function bpDocument(packing: unknown): OristudioBpDocumentState {
  return { snapshot: { packing } } as never;
}

describe('bpSheetCanSubdivide / bpSheetCanUnsubdivide', () => {
  it('reads the active designs sheet', () => {
    const document = bpDocument({ sheet, flaps: [] });
    expect(bpSheetCanSubdivide(document)).toBe(true);
    expect(bpSheetCanUnsubdivide(document)).toBe(true);
  });

  it('answers no rather than throwing on a document with nothing to read', () => {
    // These run inside `workspaceCapabilityInput`, which is recomputed on every
    // store read — a throw here would abort whatever flow happened to be running
    // rather than surfacing as a broken menu.
    for (const document of [null, bpDocument(undefined), bpDocument({ flaps: [] }), bpDocument({ sheet })]) {
      expect(bpSheetCanSubdivide(document as OristudioBpDocumentState | null)).not.toBeUndefined();
      expect(() => bpSheetCanUnsubdivide(document as OristudioBpDocumentState | null)).not.toThrow();
    }
    expect(bpSheetCanSubdivide(bpDocument({ flaps: [] }))).toBe(false);
    expect(bpSheetCanUnsubdivide(bpDocument({ flaps: [] }))).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { PropertyField, PropertySheet } from '../../lib/propertyDescriptors';
import { TEXT } from '../canvasObjects/canvasObjectKinds.fixtures';
import { buildTextProperties, type TextPropertyDeps } from './textProperties';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function deps(overrides: Partial<TextPropertyDeps> = {}): TextPropertyDeps {
  return {
    t,
    held: false,
    begin: vi.fn(() => true),
    update: vi.fn(),
    end: vi.fn(),
    commit: vi.fn(),
    updateById: vi.fn(),
    commitById: vi.fn(),
    ...overrides,
  };
}

function field(sheet: PropertySheet, id: string): PropertyField {
  const found = sheet.sections.flatMap((section) => section.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

describe('buildTextProperties', () => {
  it('names the sheet and offers the box-level fields only', () => {
    // The content's formatting — block preset, marks, alignment, colour —
    // follows the caret on the editing toolbar and is not a property of the
    // box (Decision 12 in the plan).
    const sheet = buildTextProperties({ kind: 'text', id: TEXT.id, annotation: TEXT }, deps());
    expect(sheet).toMatchObject({ kind: 'text', targetId: TEXT.id, title: 'Text', icon: 'text' });
    expect(sheet.sections.flatMap((s) => s.fields).map((f) => f.id)).toEqual(['fontSize', 'opacity']);
    for (const f of sheet.sections.flatMap((s) => s.fields)) expect(f.support).toBe('supported');
  });

  it('edits the size as a percentage of the sheet edge, as one entry', () => {
    // The sheet is 400 model units across (`ORIEDITA_PAPER_MAX − MIN`), so a
    // 16-unit font is 4% of its edge.
    const d = deps();
    const sheet = buildTextProperties(
      { kind: 'text', id: TEXT.id, annotation: { ...TEXT, fontSize: 16 } },
      d
    );
    const size = field(sheet, 'fontSize');
    if (size.kind !== 'number') throw new Error('number');
    expect(size).toMatchObject({ value: 4, suffix: '%', step: 0.5, min: 0.1 });
    size.commit(2.5);
    expect(d.commit).toHaveBeenCalledWith({ fontSize: 10 }, 'Change text size');
    size.commit(0);
    expect(d.commit).toHaveBeenLastCalledWith({ fontSize: 0.4 }, 'Change text size');
  });

  it('offers opacity through the annotation bracket', () => {
    const d = deps();
    const sheet = buildTextProperties(
      { kind: 'text', id: TEXT.id, annotation: { ...TEXT, opacity: 0.5 } },
      d
    );
    const opacity = field(sheet, 'opacity');
    if (opacity.kind !== 'slider') throw new Error('slider');
    expect(opacity.value).toBe(0.5);
    opacity.begin();
    opacity.update(0.2);
    opacity.end();
    expect(d.begin).toHaveBeenCalledWith('opacity');
    expect(d.update).toHaveBeenCalledWith({ opacity: 0.2 });
    expect(d.end).toHaveBeenCalledWith('Adjust opacity');
  });
});

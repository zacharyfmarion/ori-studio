import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { PropertyField, PropertySheet } from '../../lib/propertyDescriptors';
import { TEXT } from '../canvasObjects/canvasObjectKinds.fixtures';
import { textDocFromPlainText } from './textAnnotation';
import { setDocAlign, setDocBlock, setDocColor } from './textDocTransforms';
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
    setAlign: vi.fn(),
    setBlock: vi.fn(),
    setColor: vi.fn(),
    ...overrides,
  };
}

function field(sheet: PropertySheet, id: string): PropertyField {
  const found = sheet.sections.flatMap((section) => section.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

const TWO = textDocFromPlainText('One\nTwo');

describe('buildTextProperties', () => {
  it('names the sheet and offers the whole-box fields in order', () => {
    const sheet = buildTextProperties({ kind: 'text', id: TEXT.id, annotation: TEXT }, deps());
    expect(sheet).toMatchObject({ kind: 'text', targetId: TEXT.id, title: 'Text', icon: 'text' });
    expect(sheet.sections.flatMap((s) => s.fields).map((f) => f.id)).toEqual([
      'align',
      'block',
      'color',
      'fontSize',
      'opacity',
    ]);
    for (const f of sheet.sections.flatMap((s) => s.fields)) expect(f.support).toBe('supported');
  });

  it('reads alignment, block and colour off the stored document', () => {
    const doc = setDocColor(setDocBlock(setDocAlign(TWO, 'center'), 'h2'), '#30a46c');
    const sheet = buildTextProperties(
      { kind: 'text', id: TEXT.id, annotation: { ...TEXT, doc } },
      deps()
    );
    const align = field(sheet, 'align');
    if (align.kind !== 'segmented') throw new Error('segmented');
    expect(align.value).toBe('center');
    expect(align.options.map((o) => o.icon)).toEqual(['align-left', 'align-center', 'align-right']);
    const block = field(sheet, 'block');
    if (block.kind !== 'select') throw new Error('select');
    expect(block.value).toBe('h2');
    expect(block.options.map((o) => o.label)).toEqual(['Body', 'Heading', 'Subheading']);
    const color = field(sheet, 'color');
    if (color.kind !== 'select') throw new Error('select');
    expect(color.value).toBe('#30a46c');
    expect(color.options[0]).toEqual({ id: 'default', label: 'Default' });
    expect(color.options[1]).toMatchObject({ id: '#e5484d', label: 'Red', swatch: '#e5484d' });
  });

  it('shows the mixed state as nothing chosen when the blocks disagree', () => {
    const mixed = setDocAlign(TWO, 'right');
    (mixed.root as unknown as { children: Array<{ format: string }> }).children[1]!.format = 'left';
    const sheet = buildTextProperties(
      { kind: 'text', id: TEXT.id, annotation: { ...TEXT, doc: mixed } },
      deps()
    );
    const align = field(sheet, 'align');
    expect(align.kind === 'segmented' && align.value).toBeNull();
    const block = field(sheet, 'block');
    expect(block.kind === 'select' && block.placeholder).toBe('Mixed');
  });

  it('routes the whole-box fields through the host, which picks the write path', () => {
    const d = deps();
    const sheet = buildTextProperties({ kind: 'text', id: TEXT.id, annotation: TEXT }, d);
    const align = field(sheet, 'align');
    if (align.kind !== 'segmented') throw new Error('segmented');
    align.commit('right');
    expect(d.setAlign).toHaveBeenCalledWith('right');

    const block = field(sheet, 'block');
    if (block.kind !== 'select') throw new Error('select');
    block.commit('h1');
    expect(d.setBlock).toHaveBeenCalledWith('h1');

    const color = field(sheet, 'color');
    if (color.kind !== 'select') throw new Error('select');
    color.commit('default');
    expect(d.setColor).toHaveBeenCalledWith('');
    color.commit('#4c9aff');
    expect(d.setColor).toHaveBeenCalledWith('#4c9aff');
    // Never a free colour: anything outside the six is dropped.
    color.commit('#123456');
    expect(d.setColor).toHaveBeenCalledTimes(2);
    expect(d.commit).not.toHaveBeenCalled();
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

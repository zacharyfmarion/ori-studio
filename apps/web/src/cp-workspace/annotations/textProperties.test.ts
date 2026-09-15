import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { TEXT } from '../canvasObjects/canvasObjectKinds.fixtures';
import { buildTextProperties } from './textProperties';
import type { AnnotationPaneDeps } from './useAnnotationPaneDeps';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('buildTextProperties', () => {
  it('offers opacity through the annotation bracket', () => {
    const deps: AnnotationPaneDeps = {
      t,
      held: false,
      begin: vi.fn(() => true),
      update: vi.fn(),
      end: vi.fn(),
      commit: vi.fn(),
    };
    const sheet = buildTextProperties(
      { kind: 'text', id: TEXT.id, annotation: { ...TEXT, opacity: 0.5 } },
      deps
    );
    expect(sheet).toMatchObject({ kind: 'text', targetId: TEXT.id, title: 'Text', icon: 'text' });
    const opacity = sheet.sections[0]?.fields[0];
    if (opacity?.kind !== 'slider') throw new Error('slider');
    expect(opacity.value).toBe(0.5);
    opacity.begin();
    opacity.update(0.2);
    opacity.end();
    expect(deps.begin).toHaveBeenCalledWith('opacity');
    expect(deps.update).toHaveBeenCalledWith({ opacity: 0.2 });
    expect(deps.end).toHaveBeenCalledWith('Adjust opacity');
  });
});

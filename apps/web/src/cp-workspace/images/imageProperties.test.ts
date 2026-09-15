import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { IMAGE } from '../canvasObjects/canvasObjectKinds.fixtures';
import { degreesToRadians, radiansToDegrees, wrapDegrees } from '../../lib/angleUnits';
import { buildImageProperties, type ImagePropertyDeps } from './imageProperties';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function deps(overrides: Partial<ImagePropertyDeps> = {}): ImagePropertyDeps {
  return {
    t,
    held: false,
    begin: vi.fn(() => true),
    update: vi.fn(),
    end: vi.fn(),
    commit: vi.fn(),
    ...overrides,
  };
}

function field(sheet: ReturnType<typeof buildImageProperties>, id: string) {
  const found = sheet.sections.flatMap((section) => section.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

describe('buildImageProperties', () => {
  it('names the sheet and puts the natural size in the subtitle, not a field', () => {
    const sheet = buildImageProperties({ kind: 'image', id: IMAGE.id, annotation: IMAGE }, deps());
    expect(sheet).toMatchObject({ kind: 'image', targetId: IMAGE.id, title: 'Image', icon: 'image' });
    expect(sheet.subtitle).toBe('10 × 10');
    expect(sheet.sections.flatMap((s) => s.fields).map((f) => f.id)).toEqual([
      'opacity',
      'rotation',
    ]);
  });

  it('runs opacity through the continuous protocol on the annotation bracket', () => {
    const d = deps();
    const sheet = buildImageProperties(
      { kind: 'image', id: IMAGE.id, annotation: { ...IMAGE, opacity: 0.4 } },
      d
    );
    const opacity = field(sheet, 'opacity');
    if (opacity.kind !== 'slider') throw new Error('opacity is a slider');
    expect(opacity).toMatchObject({ value: 0.4, min: 0, max: 1, held: false, undoLabel: 'Adjust opacity' });
    expect(opacity.format?.(0.4)).toBe('40%');
    expect(opacity.begin()).toBe(true);
    expect(d.begin).toHaveBeenCalledWith('opacity');
    opacity.update(0.7);
    expect(d.update).toHaveBeenCalledWith({ opacity: 0.7 });
    opacity.end();
    expect(d.end).toHaveBeenCalledWith('Adjust opacity');
    expect(d.commit).not.toHaveBeenCalled();
  });

  it('reports the layer as held and passes a refusal through', () => {
    const d = deps({ held: true, begin: vi.fn(() => false) });
    const sheet = buildImageProperties({ kind: 'image', id: IMAGE.id, annotation: IMAGE }, d);
    const opacity = field(sheet, 'opacity');
    if (opacity.kind !== 'slider') throw new Error('opacity is a slider');
    expect(opacity.held).toBe(true);
    expect(opacity.begin()).toBe(false);
  });

  it('commits rotation in degrees as one entry, stored in radians', () => {
    const d = deps();
    const sheet = buildImageProperties(
      { kind: 'image', id: IMAGE.id, annotation: { ...IMAGE, rotation: Math.PI / 2 } },
      d
    );
    const rotation = field(sheet, 'rotation');
    if (rotation.kind !== 'number') throw new Error('rotation is a number');
    expect(rotation).toMatchObject({ value: 90, suffix: '°', step: 1, undoLabel: 'Rotate annotation' });
    rotation.commit(450);
    expect(d.commit).toHaveBeenCalledTimes(1);
    const [patch, label] = (d.commit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { rotation: number },
      string,
    ];
    expect(patch.rotation).toBeCloseTo(Math.PI / 2);
    expect(label).toBe('Rotate annotation');
    expect(d.begin).not.toHaveBeenCalled();
  });

  it('never offers a field enabled and inert', () => {
    const sheet = buildImageProperties({ kind: 'image', id: IMAGE.id, annotation: IMAGE }, deps());
    for (const f of sheet.sections.flatMap((s) => s.fields)) {
      expect(f.support).toBe('supported');
    }
  });
});

describe('degrees', () => {
  it('wraps into (−180, 180]', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(270)).toBe(-90);
    expect(wrapDegrees(-450)).toBe(-90);
  });

  it('round-trips through radians', () => {
    expect(radiansToDegrees(degreesToRadians(33))).toBe(33);
    expect(radiansToDegrees(Math.PI)).toBe(180);
    expect(radiansToDegrees(-Math.PI / 4)).toBe(-45);
  });
});

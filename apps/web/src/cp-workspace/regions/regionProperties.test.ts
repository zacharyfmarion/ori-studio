import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { PropertyField, PropertySheet } from '../../lib/propertyDescriptors';
import { IMAGE, REGION } from '../canvasObjects/canvasObjectKinds.fixtures';
import { buildRegionProperties, type RegionPropertyDeps } from './regionProperties';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function deps(overrides: Partial<RegionPropertyDeps> = {}): RegionPropertyDeps {
  return {
    t,
    held: false,
    begin: vi.fn(() => true),
    update: vi.fn(),
    end: vi.fn(),
    commit: vi.fn(),
    updateById: vi.fn(),
    commitById: vi.fn(),
    image: null,
    ...overrides,
  };
}

function field(sheet: PropertySheet, id: string): PropertyField {
  const found = sheet.sections.flatMap((section) => section.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

const target = (overrides: Partial<typeof REGION> = {}, solvable = false) =>
  ({ kind: 'suppressionRegion', id: REGION.id, annotation: { ...REGION, ...overrides }, solvable }) as const;

describe('buildRegionProperties', () => {
  it('offers the region, its checks, and no image section without an owned image', () => {
    const sheet = buildRegionProperties(target({ suppress: ['kawasaki'] }), deps());
    expect(sheet.title).toBe('Suppression region');
    expect(sheet.sections.map((s) => [s.id, s.title])).toEqual([
      ['region', 'Region'],
      ['checks', 'Suppressed checks'],
    ]);
    const checks = sheet.sections[1]!.fields;
    expect(checks.map((f) => [f.id, f.kind === 'toggle' ? f.value : null])).toEqual([
      ['check:kawasaki', true],
      ['check:bigLittleBig', false],
      ['check:maekawa', false],
      ['check:vertexClosure', false],
    ]);
    // Nothing here is a verb: no Solve, no delete, no remove-image.
    expect(sheet.sections.flatMap((s) => s.fields).map((f) => f.kind)).not.toContain('action');
  });

  it('never offers hidden — a region is deleted, not hidden', () => {
    expect(field(buildRegionProperties(target(), deps()), 'hidden').support).toBe('not-applicable');
  });

  it('uses the region label as the title when it has one', () => {
    expect(buildRegionProperties(target({ label: 'Repair area' }, true), deps()).title).toBe(
      'Repair area'
    );
  });

  it('commits the canonical toggled list as one entry and skips a no-op', () => {
    const d = deps();
    const sheet = buildRegionProperties(target({ suppress: ['vertexClosure', 'kawasaki'] }), d);
    const maekawa = field(sheet, 'check:maekawa');
    if (maekawa.kind !== 'toggle') throw new Error('toggle');
    maekawa.commit(true);
    expect(d.commit).toHaveBeenCalledWith(
      { suppress: ['kawasaki', 'maekawa', 'vertexClosure'] },
      'Change suppressed checks'
    );
    maekawa.commit(false);
    expect(d.commit).toHaveBeenCalledTimes(1);
  });

  it('slides the region opacity through the annotation bracket', () => {
    const d = deps();
    const opacity = field(buildRegionProperties(target({ opacity: 0.5 }), d), 'opacity');
    if (opacity.kind !== 'slider') throw new Error('slider');
    expect(opacity.value).toBe(0.5);
    opacity.begin();
    opacity.update(0.8);
    opacity.end();
    expect(d.begin).toHaveBeenCalledWith('opacity');
    expect(d.update).toHaveBeenCalledWith({ opacity: 0.8 });
    expect(d.end).toHaveBeenCalledWith('Adjust opacity');
  });

  it('adds the owned image’s visibility and opacity, addressed to the image', () => {
    const d = deps({ image: { ...IMAGE, hidden: true, opacity: 0.4 } });
    const sheet = buildRegionProperties(target({ imageId: IMAGE.id }), d);
    expect(sheet.sections.map((s) => s.id)).toEqual(['region', 'checks', 'image']);
    expect(sheet.sections[2]?.title).toBe('Reference image');

    const shown = field(sheet, 'imageShown');
    if (shown.kind !== 'toggle') throw new Error('toggle');
    expect(shown.value).toBe(false);
    shown.commit(true);
    expect(d.commitById).toHaveBeenCalledWith(
      IMAGE.id,
      { hidden: false },
      'Show or hide reference image'
    );

    const opacity = field(sheet, 'imageOpacity');
    if (opacity.kind !== 'slider') throw new Error('slider');
    expect(opacity.value).toBe(0.4);
    opacity.begin();
    opacity.update(0.9);
    opacity.end();
    expect(d.begin).toHaveBeenCalledWith('imageOpacity');
    expect(d.updateById).toHaveBeenCalledWith(IMAGE.id, { opacity: 0.9 });
    expect(d.end).toHaveBeenCalledWith('Adjust reference image');
    // The region's own writes were never touched.
    expect(d.update).not.toHaveBeenCalled();
    expect(d.commit).not.toHaveBeenCalled();
  });
});

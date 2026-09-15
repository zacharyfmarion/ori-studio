import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { REGION } from '../canvasObjects/canvasObjectKinds.fixtures';
import type { AnnotationPaneDeps } from '../annotations/useAnnotationPaneDeps';
import { buildRegionProperties } from './regionProperties';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function deps(): AnnotationPaneDeps {
  return { t, held: false, begin: vi.fn(() => true), update: vi.fn(), end: vi.fn(), commit: vi.fn() };
}

describe('buildRegionProperties', () => {
  it('offers one toggle per check class, tick meaning suppressed', () => {
    const sheet = buildRegionProperties(
      {
        kind: 'suppressionRegion',
        id: REGION.id,
        annotation: { ...REGION, suppress: ['kawasaki'] },
        solvable: false,
      },
      deps()
    );
    expect(sheet.title).toBe('Suppression region');
    const fields = sheet.sections.flatMap((s) => s.fields);
    expect(fields.map((f) => [f.id, f.kind === 'toggle' ? f.value : null])).toEqual([
      ['check:kawasaki', true],
      ['check:bigLittleBig', false],
      ['check:maekawa', false],
      ['check:vertexClosure', false],
    ]);
  });

  it('uses the region label as the title when it has one', () => {
    const sheet = buildRegionProperties(
      { kind: 'suppressionRegion', id: REGION.id, annotation: { ...REGION, label: 'Repair area' }, solvable: true },
      deps()
    );
    expect(sheet.title).toBe('Repair area');
  });

  it('commits the canonical toggled list as one entry and skips a no-op', () => {
    const d = deps();
    const sheet = buildRegionProperties(
      {
        kind: 'suppressionRegion',
        id: REGION.id,
        annotation: { ...REGION, suppress: ['vertexClosure', 'kawasaki'] },
        solvable: false,
      },
      d
    );
    const maekawa = sheet.sections[0]?.fields.find((f) => f.id === 'check:maekawa');
    if (maekawa?.kind !== 'toggle') throw new Error('toggle');
    maekawa.commit(true);
    expect(d.commit).toHaveBeenCalledWith(
      { suppress: ['kawasaki', 'maekawa', 'vertexClosure'] },
      'Change suppressed checks'
    );
    maekawa.commit(false);
    expect(d.commit).toHaveBeenCalledTimes(1);
  });
});

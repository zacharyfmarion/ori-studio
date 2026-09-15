import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import { cpRegionMenuItems } from './regionMenuItems';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('cpRegionMenuItems', () => {
  it('offers the suppressed checks as a submenu of ticks, and delete', () => {
    const toggleCheckClass = vi.fn();
    const remove = vi.fn();
    const region = createCpSuppressionRegion({
      id: 'region-1',
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      suppress: ['maekawa'],
    });
    const items = cpRegionMenuItems(region, { t, toggleCheckClass, remove });

    expect(items.map((item) => item.kind)).toEqual(['submenu', 'separator', 'action']);
    const checks = items[0];
    if (checks?.kind !== 'submenu') throw new Error('submenu');
    expect(checks.label).toBe('Suppressed checks');
    expect(
      checks.items.map((item) => (item.kind === 'radio' ? [item.label, item.checked] : null))
    ).toEqual([
      ['Kawasaki (angles)', false],
      ['Big-little-big', false],
      ['Maekawa (parity)', true],
      ['Vertex closure', false],
    ]);
    const kawasaki = checks.items[0];
    if (kawasaki?.kind !== 'radio') throw new Error('radio');
    kawasaki.onSelect();
    expect(toggleCheckClass).toHaveBeenCalledWith('kawasaki');

    const del = items[2];
    if (del?.kind !== 'action') throw new Error('action');
    expect(del).toMatchObject({ label: 'Delete region', danger: true });
    del.onSelect();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

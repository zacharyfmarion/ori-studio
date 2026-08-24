import { describe, expect, it } from 'vitest';
import { ORISTUDIO_CP_ACTIONS } from '../../lib/oristudioCpActions';
import { cpRailGroups, isCpRailAction } from './cpRailActions';
import { cpToolGlyphKey } from './cpToolGlyph';

describe('cpRailGroups', () => {
  it('covers every rail action exactly once', () => {
    const listed = cpRailGroups().flatMap((entry) => entry.actions.map((action) => action.id));
    const expected = ORISTUDIO_CP_ACTIONS.filter(isCpRailAction).map((action) => action.id);

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...expected].sort());
  });

  it('drops groups with nothing on the rail rather than rendering an empty heading', () => {
    for (const { actions } of cpRailGroups()) expect(actions.length).toBeGreaterThan(0);
  });
});

/*
 * The picker exists to name the icons, which only works while the icons are
 * distinguishable — two rows with the same mark and different names read as a
 * mistake in the app rather than as two tools.
 *
 * Asserted on what is *rendered*, not on the `icon` field: that field collides
 * six ways, but most of those pairs draw different Oriedita glyphs and only a
 * rendered collision can confuse anyone. `circle-dot` was the one that reached
 * the screen, on "Circle through three points" and "Concentric from selection";
 * the latter now draws `target`.
 */
describe('rail glyphs', () => {
  it('draws a distinguishable mark for every rail tool', () => {
    const byGlyph = new Map<string, string[]>();
    for (const { actions } of cpRailGroups()) {
      for (const action of actions) {
        const key = cpToolGlyphKey(action);
        byGlyph.set(key, [...(byGlyph.get(key) ?? []), action.label]);
      }
    }

    const collisions = [...byGlyph.entries()].filter(([, labels]) => labels.length > 1);
    expect(collisions).toEqual([]);
  });
});

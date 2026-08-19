import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { kindHasPackingCircles, sendToEditPrimary, sendToEditVariants } from './sendToEditActions';
import { DESIGN_KINDS } from './registry';

/** Enough of `t` for a catalog that only ever calls `t(key, english)`. */
const t = ((_key: string, english: string) => english) as unknown as TFunction;

describe('sendToEditActions', () => {
  it('offers every kind a primary Send to Edit', () => {
    for (const kind of DESIGN_KINDS) {
      expect(sendToEditPrimary(t).includeCircles).toBe(false);
      expect(sendToEditPrimary(t).label).toBe('Send to Edit');
      // No kind is left without the primary verb.
      expect(sendToEditVariants(kind.id, t)).toBeInstanceOf(Array);
    }
  });

  it('offers the with-circles variant to the kinds that have a packing', () => {
    expect(sendToEditVariants('treemaker', t)).toEqual([
      expect.objectContaining({ id: 'with-circles', includeCircles: true }),
    ]);
    expect(sendToEditVariants('box-pleat', t)).toEqual([
      expect.objectContaining({ id: 'with-circles', includeCircles: true }),
    ]);
  });

  it('offers ExplOri no variant, so its button keeps no caret', () => {
    // A result is a lookup into a tiling archive — no radius anywhere, and no
    // scale to derive one from, because the tiling is not a packing of the
    // user's tree. An empty list is what makes SplitButton fall back to a plain
    // button rather than opening an empty menu.
    expect(kindHasPackingCircles('explori')).toBe(false);
    expect(sendToEditVariants('explori', t)).toEqual([]);
  });
});

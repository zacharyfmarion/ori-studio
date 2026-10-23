import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import {
  kindHasPackingCircles,
  sendToEditButtonModel,
  sendToEditPrimary,
  sendToEditVariants,
  type SendToEditSurfaceSource,
} from './sendToEditActions';
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

describe('sendToEditActions from a source that is not a design', () => {
  const surface: SendToEditSurfaceSource = { title: "Send this sequence's crease pattern" };

  it('offers the same verb, with its own account of what is sent', () => {
    // "This design's" would be wrong said of anything else, so the surface
    // supplies that sentence and only that sentence.
    const primary = sendToEditPrimary(t, surface);
    expect(primary).toEqual({ ...sendToEditPrimary(t), title: surface.title });
  });

  it('keeps a plain button unless it names variants', () => {
    expect(sendToEditVariants(surface, t)).toEqual([]);
    expect(sendToEditVariants({ ...surface, variants: [] }, t)).toEqual([]);
  });

  it('gets the same variant a design kind does when it names one', () => {
    // One wording per variant, whichever source offers it.
    expect(sendToEditVariants({ ...surface, variants: ['with-circles'] }, t)).toEqual(
      sendToEditVariants('treemaker', t)
    );
  });

  it('gives a design kind named as the source the design tooltip', () => {
    expect(sendToEditPrimary(t, 'explori')).toEqual(sendToEditPrimary(t));
  });
});

describe('sendToEditButtonModel', () => {
  it('runs the primary, and each variant, through the one binding', () => {
    const send = vi.fn();
    const model = sendToEditButtonModel('box-pleat', t, { send, disabled: false });
    expect(model.label).toBe('Send to Edit');
    expect(model.menuLabel).toBe('More Send to Edit options');

    model.run();
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'plain', includeCircles: false })
    );

    expect(model.actions.map((action) => action.id)).toEqual(['with-circles']);
    model.actions[0].onSelect();
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'with-circles', includeCircles: true })
    );
  });

  it('says why it is disabled in place of the tooltip, and only while disabled', () => {
    const reason = 'Build a crease pattern first';
    const title = (disabled: boolean, why?: string) =>
      sendToEditButtonModel('treemaker', t, { send: vi.fn(), disabled, reason: why }).title;
    expect(title(true, reason)).toBe(reason);
    expect(title(false, reason)).toBe(sendToEditPrimary(t).title);
    // Disabled with nothing to say keeps the ordinary tooltip rather than none.
    expect(title(true)).toBe(sendToEditPrimary(t).title);
  });

  it('gives a surface the same button over its own title and variants', () => {
    const send = vi.fn();
    const model = sendToEditButtonModel({ title: 'Send the folded sheet' }, t, {
      send,
      disabled: false,
    });
    expect(model).toMatchObject({
      label: 'Send to Edit',
      title: 'Send the folded sheet',
      menuLabel: 'More Send to Edit options',
      disabled: false,
      actions: [],
    });
    model.run();
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'plain' }));
  });
});

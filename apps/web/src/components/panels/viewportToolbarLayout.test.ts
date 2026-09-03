import { describe, expect, it } from 'vitest';
import {
  hasUnseenActiveControl,
  planViewportToolbar,
  viewportToolbarSlots,
  type ViewportToolbarAction,
  type ViewportToolbarGroupSpec,
  type ViewportToolbarItem,
  type ViewportToolbarNode,
} from './viewportToolbarLayout';

function action(id: string, extra: Partial<ViewportToolbarAction> = {}): ViewportToolbarAction {
  return { kind: 'action', id, label: id, icon: null, onSelect: () => {}, ...extra };
}

function node(id: string, extra: Partial<ViewportToolbarNode> = {}): ViewportToolbarItem {
  return { kind: 'node', id, node: null, ...extra };
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

/**
 * The four surfaces that render the bar, with the controls each declares — the
 * shape of the real call sites rather than a convenient fixture, since the
 * arrangement only goes wrong on a combination someone actually ships.
 *
 * The `zoom` and `view` groups are the bar's own; the rest is what the surface
 * passes as `groups`.
 */
function surfaceGroups(options: {
  pan?: boolean;
  rotate?: boolean;
  editableCp?: boolean;
  symmetry?: boolean;
  canUnpair?: boolean;
  layers?: string[];
}): ViewportToolbarGroupSpec[] {
  const layers = options.layers ?? [];
  return [
    { id: 'zoom', items: [action('zoom-out', { pinned: true }), node('zoom-readout'), action('zoom-in', { pinned: true })] },
    {
      id: 'view',
      items: [
        action('fit', { pinned: true }),
        options.pan && action('pan', { checked: false, unseenWhenCollapsed: false }),
        options.rotate && action('rotate-ccw'),
        options.rotate && node('rotation', { only: 'fine' }),
        options.rotate && action('rotate-cw'),
        options.rotate && action('rotate-reset', { only: 'coarse' }),
      ],
    },
    ...(options.editableCp
      ? [
          { id: 'image', items: [action('insert-image')] },
          { id: 'fold', items: [node('fold')] },
        ]
      : []),
    ...(options.symmetry
      ? [
          {
            id: 'symmetry',
            items: [
              node('symmetry', { only: 'fine' }),
              action('symmetry', { only: 'coarse', checked: false }),
              options.canUnpair && action('unpair'),
            ],
          },
        ]
      : []),
    ...(layers.length > 0
      ? [
          {
            id: 'layers',
            items: [
              node('layers', { only: 'fine' }),
              ...layers.map((key) => action(`layer-${key}`, { only: 'coarse', checked: true })),
            ],
          },
        ]
      : []),
  ];
}

/** Every conditional combination the four call sites can produce. */
const SURFACES: { name: string; groups: ViewportToolbarGroupSpec[] }[] = [];
for (const pan of [false, true]) {
  for (const rotate of [false, true]) {
    for (const editableCp of [false, true]) {
      for (const symmetry of [false, true]) {
        for (const canUnpair of [false, true]) {
          for (const layers of [[], ['labels'], ['grid', 'labels', 'axes']]) {
            SURFACES.push({
              name: `pan=${pan} rotate=${rotate} cp=${editableCp} sym=${symmetry} unpair=${canUnpair} layers=${layers.length}`,
              groups: surfaceGroups({ pan, rotate, editableCp, symmetry, canUnpair, layers }),
            });
          }
        }
      }
    }
  }
}

describe('planViewportToolbar', () => {
  it('leaves a fine pointer with everything inline, in declaration order', () => {
    const plan = planViewportToolbar(surfaceGroups({ pan: true, rotate: true, editableCp: true }), false);
    expect(plan.overflow).toEqual([]);
    expect(ids(plan.inline)).toEqual(['zoom', 'view', 'image', 'fold']);
    expect(ids(plan.inline[1].items)).toEqual(['fit', 'pan', 'rotate-ccw', 'rotation', 'rotate-cw']);
  });

  it('drops coarse-only items from a fine pointer', () => {
    const plan = planViewportToolbar(surfaceGroups({ rotate: true }), false);
    expect(ids(plan.inline[1].items)).not.toContain('rotate-reset');
  });

  it('drops fine-only items from a coarse pointer', () => {
    const plan = planViewportToolbar(surfaceGroups({ rotate: true, layers: ['labels'] }), true);
    const inlineIds = plan.inline.flatMap((group) => ids(group.items));
    expect(inlineIds).not.toContain('rotation');
    expect(inlineIds).not.toContain('layers');
  });

  it('collapses the verbs a gesture covers and keeps the pinned ones', () => {
    const plan = planViewportToolbar(
      surfaceGroups({ pan: true, rotate: true, editableCp: true }),
      true
    );
    expect(plan.inline.map((group) => [group.id, ids(group.items)])).toEqual([
      ['zoom', ['zoom-out', 'zoom-readout', 'zoom-in']],
      ['view', ['fit']],
      ['fold', ['fold']],
    ]);
    expect(plan.overflow.map((group) => [group.id, ids(group.items)])).toEqual([
      ['view', ['pan', 'rotate-ccw', 'rotate-cw', 'rotate-reset']],
      ['image', ['insert-image']],
    ]);
  });

  it('never emits an empty group, under any combination of conditional controls', () => {
    for (const surface of SURFACES) {
      for (const coarse of [false, true]) {
        const plan = planViewportToolbar(surface.groups, coarse);
        for (const group of [...plan.inline, ...plan.overflow]) {
          expect(group.items.length, `${surface.name} coarse=${coarse} group=${group.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('loses no control: inline and overflow partition what the pointer can see', () => {
    for (const surface of SURFACES) {
      for (const coarse of [false, true]) {
        const plan = planViewportToolbar(surface.groups, coarse);
        const seen = [
          ...plan.inline.flatMap((group) => ids(group.items)),
          ...plan.overflow.flatMap((group) => ids(group.items)),
        ].sort();
        const expected = surface.groups
          .flatMap((group) => group.items)
          .filter((item) => item && (item.only === undefined || item.only === (coarse ? 'coarse' : 'fine')))
          .map((item) => (item as ViewportToolbarItem).id)
          .sort();
        expect(seen, `${surface.name} coarse=${coarse}`).toEqual(expected);
      }
    }
  });

  it('keeps popovers and forms out of the overflow menu', () => {
    for (const surface of SURFACES) {
      const plan = planViewportToolbar(surface.groups, true);
      for (const group of plan.overflow) {
        for (const item of group.items) expect(item.kind).toBe('action');
      }
    }
  });
});

describe('viewportToolbarSlots', () => {
  /**
   * The complaint that started this: `flex-wrap` broke the row wherever width
   * ran out, which repeatedly left a hairline at the end of a line with nothing
   * after it. A separator is now derived from a seam between two groups, so this
   * is the property that has to hold for every arrangement.
   */
  it('never places a separator first, last, or beside another', () => {
    for (const surface of SURFACES) {
      for (const coarse of [false, true]) {
        const plan = planViewportToolbar(surface.groups, coarse);
        for (const [where, groups] of [
          ['inline', plan.inline],
          ['overflow', plan.overflow],
        ] as const) {
          const kinds = viewportToolbarSlots(groups).map((slot) => slot.kind);
          const label = `${surface.name} coarse=${coarse} ${where}`;
          expect(kinds[0], label).not.toBe('separator');
          expect(kinds[kinds.length - 1], label).not.toBe('separator');
          for (let i = 1; i < kinds.length; i += 1) {
            expect(
              kinds[i] === 'separator' && kinds[i - 1] === 'separator',
              `${label}: doubled separator at ${i}`
            ).toBe(false);
          }
        }
      }
    }
  });

  it('puts exactly one separator between each pair of groups', () => {
    const slots = viewportToolbarSlots([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(slots.map((slot) => (slot.kind === 'separator' ? '|' : slot.id))).toEqual([
      'a',
      '|',
      'b',
      '|',
      'c',
    ]);
  });

  it('draws no separator for a single group, or none', () => {
    expect(viewportToolbarSlots([{ id: 'only' }]).map((slot) => slot.kind)).toEqual(['group']);
    expect(viewportToolbarSlots([])).toEqual([]);
  });
});

describe('hasUnseenActiveControl', () => {
  it('reports a mode that is on and shows nowhere else', () => {
    expect(
      hasUnseenActiveControl([
        { id: 'view', items: [action('pan', { checked: true, unseenWhenCollapsed: true })] },
      ])
    ).toBe(true);
  });

  /**
   * The case the old shape could not express. A verb has no `checked` to be
   * combined with, so gating the signal on one restricted it to modes — and the
   * crease angle, a *value* away from its default with no other trace on a
   * phone, went unannounced.
   */
  it('reports a verb holding a non-default value', () => {
    expect(
      hasUnseenActiveControl([
        { id: 'angle', items: [action('crease-angle', { unseenWhenCollapsed: true })] },
      ])
    ).toBe(true);
  });

  it('ignores plain verbs and controls at rest', () => {
    expect(
      hasUnseenActiveControl([
        {
          id: 'view',
          items: [
            action('pan', { checked: false, unseenWhenCollapsed: false }),
            action('crease-angle', { unseenWhenCollapsed: false }),
            action('insert-image'),
          ],
        },
      ])
    ).toBe(false);
    expect(hasUnseenActiveControl([])).toBe(false);
  });

  /**
   * Layers default to visible and mirror draw puts its axis on the paper, so
   * counting every checked item would leave the trigger permanently lit and the
   * signal worth nothing. Which is why the flag is opt-in rather than derived.
   */
  it('ignores a mode the canvas already shows', () => {
    expect(
      hasUnseenActiveControl([
        { id: 'layers', items: [action('layer-labels', { checked: true })] },
        { id: 'symmetry', items: [action('symmetry', { checked: true })] },
      ])
    ).toBe(false);
  });
});

/**
 * The phone hands its one strip to the surface's own controls, so what a pin
 * means there is a different question from what it means on a tablet.
 *
 * `phone` is always passed with `coarse`, never alone — a phone that reports a
 * fine pointer is not a device.
 */
describe('planViewportToolbar on a phone', () => {
  const shared: ViewportToolbarGroupSpec[] = [
    {
      id: 'zoom',
      items: [
        action('zoom-out', { pinned: true, onPhone: 'omit' }),
        node('zoom-readout', { onPhone: 'omit' }),
        action('zoom-in', { pinned: true, onPhone: 'omit' }),
      ],
    },
    {
      id: 'view',
      items: [action('fit', { pinned: true, onPhone: 'collapse' }), action('pan')],
    },
    { id: 'favorites', items: [action('favorite-draw', { pinned: true })] },
  ];

  it('drops an omitted control from the bar and from the menu alike', () => {
    const plan = planViewportToolbar(shared, true, true);
    expect(plan.inline.map((group) => group.id)).not.toContain('zoom');
    expect(plan.overflow.map((group) => group.id)).not.toContain('zoom');
  });

  /*
   * The one that would silently take a control away. `pinned` and
   * `onPhone: 'collapse'` disagree by construction, and the phone has to win —
   * otherwise Fit stays on a bar that no longer has room for it.
   */
  it('collapses a pinned control the phone asked to collapse', () => {
    const plan = planViewportToolbar(shared, true, true);
    expect(plan.inline.flatMap((group) => ids(group.items))).not.toContain('fit');
    expect(plan.overflow.flatMap((group) => ids(group.items))).toContain('fit');
  });

  it('leaves the surface its own pinned controls, which is the point', () => {
    const plan = planViewportToolbar(shared, true, true);
    expect(plan.inline.flatMap((group) => ids(group.items))).toEqual(['favorite-draw']);
  });

  // A tablet keeps its rail, so it keeps the view controls it always had.
  it('changes nothing for a coarse pointer that is not a phone', () => {
    const plan = planViewportToolbar(shared, true, false);
    expect(plan.inline.flatMap((group) => ids(group.items))).toEqual([
      'zoom-out',
      'zoom-readout',
      'zoom-in',
      'fit',
      'favorite-draw',
    ]);
    expect(plan.overflow.flatMap((group) => ids(group.items))).toEqual(['pan']);
  });

  // Nothing collapses under a fine pointer, so the phone fields are inert there
  // rather than quietly emptying a desktop bar.
  it('changes nothing for a fine pointer', () => {
    const plan = planViewportToolbar(shared, false, false);
    expect(plan.inline.flatMap((group) => ids(group.items))).toHaveLength(6);
    expect(plan.overflow).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  selectOristudioBpHistoryPast,
  selectOristudioBpSymmetry,
  singleBoxPleatDesignTab,
} from '../designTabs';
import type {
  OristudioBpDocumentState,
  OristudioBpSheet,
} from '../../../engine/oristudioBpTypes';

/**
 * The sheet transforms carry the mirror with them.
 *
 * Each one moves the layout rigidly, so the *geometry* stays as symmetric as it
 * was and the engine needs no help — the rule itself is unit-tested in
 * `lib/bpPackingSymmetry.test.ts`. What these cover is the bookkeeping the store
 * owes on top: that the recorded orientation follows the design, that it does so
 * on the same undo entry as the geometry, and that nothing else writes it.
 */

const runtimeMocks = vi.hoisted(() => ({
  subdivideOristudioBpLayoutSheet: vi.fn(),
  unsubdivideOristudioBpLayoutSheet: vi.fn(),
  rotateOristudioBpLayoutSheet: vi.fn(),
  flipOristudioBpLayoutSheet: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return { ...actual, ...runtimeMocks };
});

const { useWorkspaceStore } = await import('../store');

function sheet(kind: OristudioBpSheet['kind'] = 'rectangular'): OristudioBpSheet {
  return { kind, width: 16, height: 16, grid: { kind: 'rectangular', interval: 1, snap: true } };
}

/** Only the fields the transform path reads; the rest is inert here. */
function bpDocument(kind: OristudioBpSheet['kind'] = 'rectangular'): OristudioBpDocumentState {
  return {
    activeSurface: 'packing',
    snapshot: {
      tree: { sheet: sheet(kind), vertices: [], edges: [] },
      packing: { sheet: sheet(kind), flaps: [] },
    },
  } as unknown as OristudioBpDocumentState;
}

function setUp(
  options: {
    fold?: 'book' | 'diagonal';
    quarterTurn?: boolean;
    enabled?: boolean;
    kind?: OristudioBpSheet['kind'];
  } = {}
) {
  const kind = options.kind ?? 'rectangular';
  for (const run of [
    runtimeMocks.subdivideOristudioBpLayoutSheet,
    runtimeMocks.unsubdivideOristudioBpLayoutSheet,
    runtimeMocks.rotateOristudioBpLayoutSheet,
    runtimeMocks.flipOristudioBpLayoutSheet,
  ]) {
    run.mockImplementation(async () => bpDocument(kind));
  }
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: bpDocument(kind),
        symmetry: {
          angle: 90,
          loc: { x: 8, y: 8 },
          enabled: options.enabled ?? true,
          fold: options.fold ?? 'book',
          quarterTurn: options.quarterTurn ?? false,
          pairs: [],
        },
      }),
    },
    true
  );
}

const orientation = () => {
  const { fold, quarterTurn } = selectOristudioBpSymmetry(useWorkspaceStore.getState());
  return { fold, quarterTurn };
};

beforeEach(() => setUp());

afterEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('sheet transforms and the mirror', () => {
  it('turns the mirror a quarter turn on rotate', async () => {
    await useWorkspaceStore.getState().rotateOristudioBpLayoutSheet(true);
    expect(orientation()).toEqual({ fold: 'book', quarterTurn: true });
    await useWorkspaceStore.getState().rotateOristudioBpLayoutSheet(true);
    expect(orientation()).toEqual({ fold: 'book', quarterTurn: false });
  });

  it('turns it counterclockwise too: both land on the same line', async () => {
    await useWorkspaceStore.getState().rotateOristudioBpLayoutSheet(false);
    expect(orientation()).toEqual({ fold: 'book', quarterTurn: true });
  });

  it('leaves a book fold alone on a flip, which carries it onto itself', async () => {
    for (const horizontal of [true, false]) {
      setUp();
      await useWorkspaceStore.getState().flipOristudioBpLayoutSheet(horizontal);
      expect(orientation()).toEqual({ fold: 'book', quarterTurn: false });
    }
  });

  it('swaps the two diagonals on a flip', async () => {
    setUp({ fold: 'diagonal' });
    await useWorkspaceStore.getState().flipOristudioBpLayoutSheet(true);
    expect(orientation()).toEqual({ fold: 'diagonal', quarterTurn: true });
  });

  it('reads the diagonal from the layout sheet, not the fold name', async () => {
    // On a diamond it is the *book* fold that runs at 45 degrees, so that is the
    // one a flip moves and the diagonal fold is the one it leaves alone.
    setUp({ fold: 'book', kind: 'diagonal' });
    await useWorkspaceStore.getState().flipOristudioBpLayoutSheet(true);
    expect(orientation()).toEqual({ fold: 'book', quarterTurn: true });

    setUp({ fold: 'diagonal', kind: 'diagonal' });
    await useWorkspaceStore.getState().flipOristudioBpLayoutSheet(true);
    expect(orientation()).toEqual({ fold: 'diagonal', quarterTurn: false });
  });

  it('leaves the mirror where it is when the sheet only changes scale', async () => {
    await useWorkspaceStore.getState().subdivideOristudioBpLayoutSheet();
    expect(orientation()).toEqual({ fold: 'book', quarterTurn: false });
    await useWorkspaceStore.getState().unsubdivideOristudioBpLayoutSheet();
    expect(orientation()).toEqual({ fold: 'book', quarterTurn: false });
  });

  it('writes it with mirror draw off, because the fold outlives the toggle', async () => {
    // "This model is book-symmetric" is a fact about the model, so a design
    // rotated with the toggle off has to come back right when it is turned on.
    setUp({ enabled: false });
    await useWorkspaceStore.getState().rotateOristudioBpLayoutSheet(true);
    expect(orientation()).toEqual({ fold: 'book', quarterTurn: true });
  });

  it('never changes the class: a rotated book fold is still a book fold', async () => {
    setUp({ fold: 'diagonal' });
    await useWorkspaceStore.getState().rotateOristudioBpLayoutSheet(true);
    expect(orientation().fold).toBe('diagonal');
  });

  it('puts the turn on the same undo entry as the geometry', async () => {
    await useWorkspaceStore.getState().rotateOristudioBpLayoutSheet(true);
    const past = selectOristudioBpHistoryPast(useWorkspaceStore.getState());
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe('Rotated BP sheet right');
    // The entry restores the orientation the design had *before* the rotate, so
    // undoing puts the mirror back with the flaps rather than a step behind them.
    expect(past[0].snapshot.symmetry).toMatchObject({ fold: 'book', quarterTurn: false });
  });
});

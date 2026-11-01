/**
 * The export and share previews' fold is keyed by what shapes it — the
 * pattern, the side, the case, the layer order — and not by its colours: a
 * colour edit repaints a figure with a paper scene and folds nothing, a fold
 * with no paper scene (whose drawing holds its colours) is folded again, and
 * a fold still running when a colour changes is waited for, not started again.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreaseExportFoldedFigureSettings } from '../../lib/creaseExport';
import {
  IDENTITY_CP_MODEL_TO_FOLD,
  type CreaseExportFoldResult,
  type CreaseExportOrderedFold,
} from '../../lib/creaseExportFold';
import type { LayerOrderApplied, LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import type { OristudioCpFoldedPaperScene, OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import {
  useFoldedFigurePreview,
  type FoldedFigureOrder,
  type FoldedFigurePreview,
  type FoldedFigurePreviewOptions,
} from './useFoldedFigurePreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS: CreaseExportFoldedFigureSettings = {
  side: 'Front0',
  frontColor: '#ffff32',
  backColor: '#e9e9e9',
  foldCase: 1,
};

function result(withScene: boolean, settings: CreaseExportFoldedFigureSettings): CreaseExportFoldResult {
  return {
    snapshot: { schema_version: 1, fixture: null, pass: null, primitives: [], colour: settings.frontColor } as unknown as
      OristudioCpFoldedRenderSnapshot,
    scene: withScene ? ({ faces: [] } as unknown as OristudioCpFoldedPaperScene) : null,
    discoveredCases: 1,
    transform: IDENTITY_CP_MODEL_TO_FOLD,
  };
}

/** What a fold of the creases `digest` names was made from. */
const sourceOf = (digest: string): LayerOrderSource => ({
  segments: [],
  startingFaceId: 1,
  auxSegments: [],
  model: DEFAULT_FOLDED_MODEL,
  digest,
});

/** A fold of the creases `digest` names, its snapshot saying which, and whether in their chosen order. */
function foldOf(digest: string, chosenOrder = false): CreaseExportFoldResult {
  return {
    snapshot: { primitives: [], drawn: chosenOrder ? `${digest} in its order` : digest } as unknown as
      OristudioCpFoldedRenderSnapshot,
    scene: { faces: [] } as unknown as OristudioCpFoldedPaperScene,
    discoveredCases: 1,
    transform: IDENTITY_CP_MODEL_TO_FOLD,
    source: sourceOf(digest),
    chosenOrder,
  };
}

/** An order chosen in the Layer order dialog for the creases `digest` names. */
function orderOn(digest: string): FoldedFigureOrder {
  return {
    applied: { record: { faces: [], constraints: [], order: [] }, relations: new Uint32Array(0), source: sourceOf(digest) },
    key: `order:${digest}`,
  };
}

/** The session's chosen orders, looked up as the dialogs do: by the digest of the creases they were chosen on. */
const lookup =
  (...orders: FoldedFigureOrder[]) =>
  (digest: string) =>
    orders.find((order) => order.applied.source.digest === digest) ?? null;

/** A fold in a chosen order, as the workspace's: it folds the creases the order was chosen on. */
const foldsInOrder = () =>
  vi.fn(async (_settings: unknown, order: LayerOrderApplied): Promise<CreaseExportOrderedFold> => ({
    status: 'folded',
    result: foldOf(order.source.digest, true),
  }));

/** The kernel will not draw the order. */
const refusesOrder = () => vi.fn(async (): Promise<CreaseExportOrderedFold> => ({ status: 'refused' }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let shown: FoldedFigurePreview | null = null;

/** What the figure on show is a fold of. */
const drawn = () => (shown!.figure as unknown as { drawn: string } | null)?.drawn ?? null;

/** The hook's options a test sets beyond the settings and the fold. */
type ProbeOptions = Partial<Omit<FoldedFigurePreviewOptions, 'settings' | 'fold'>>;

function Probe({
  settings,
  fold,
  options,
}: {
  settings: CreaseExportFoldedFigureSettings;
  fold: (settings: CreaseExportFoldedFigureSettings) => Promise<CreaseExportFoldResult>;
  options?: ProbeOptions;
}) {
  const preview = useFoldedFigurePreview({ enabled: true, settings, fold, cacheKeyPrefix: '1', ...options });
  useEffect(() => {
    shown = preview;
  });
  return null;
}

async function render(
  settings: CreaseExportFoldedFigureSettings,
  fold: Parameters<typeof Probe>[0]['fold'],
  options?: ProbeOptions
) {
  await act(async () => {
    root!.render(<Probe settings={settings} fold={fold} options={options} />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
  shown = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
});

describe('a preview fold', () => {
  it('repaints a figure with a paper scene in new colours, folding nothing', async () => {
    const fold = vi.fn(async (settings: CreaseExportFoldedFigureSettings) => result(true, settings));
    await render(SETTINGS, fold);
    const first = shown!.figure;
    await render({ ...SETTINGS, frontColor: '#123456' }, fold);
    await render({ ...SETTINGS, frontColor: '#123456', backColor: '#654321' }, fold);
    expect(fold).toHaveBeenCalledTimes(1);
    expect(shown!.figure).toBe(first);
    expect(shown!.folding).toBe(false);
  });

  it('folds a figure with no paper scene again, since its drawing holds its colours', async () => {
    const fold = vi.fn(async (settings: CreaseExportFoldedFigureSettings) => result(false, settings));
    await render(SETTINGS, fold);
    await render({ ...SETTINGS, frontColor: '#123456' }, fold);
    expect(fold).toHaveBeenCalledTimes(2);
    expect(fold.mock.lastCall![0].frontColor).toBe('#123456');
    expect((shown!.figure as unknown as { colour: string }).colour).toBe('#123456');
    // Back to the first colours: folded again, since one drawing is kept per geometry.
    await render(SETTINGS, fold);
    expect(fold).toHaveBeenCalledTimes(3);
    expect((shown!.figure as unknown as { colour: string }).colour).toBe(SETTINGS.frontColor);
  });

  it('waits for a fold still running when a colour changes, rather than folding again', async () => {
    let land!: () => void;
    const fold = vi.fn(
      (settings: CreaseExportFoldedFigureSettings) =>
        new Promise<CreaseExportFoldResult>((resolve) => {
          land = () => resolve(result(true, settings));
        })
    );
    await render(SETTINGS, fold);
    expect(shown!.folding).toBe(true);
    await render({ ...SETTINGS, frontColor: '#123456' }, fold);
    await act(async () => land());
    expect(fold).toHaveBeenCalledTimes(1);
    expect(shown!.figure).not.toBeNull();
    expect(shown!.folding).toBe(false);
  });

  it('folds again for another side or case, and not for a spread', async () => {
    const fold = vi.fn(async (settings: CreaseExportFoldedFigureSettings) => result(true, settings));
    await render(SETTINGS, fold);
    await render(
      { ...SETTINGS, spread: { kind: 'depth', amount: 0.05, toward: 'down' } },
      fold
    );
    expect(fold).toHaveBeenCalledTimes(1);
    await render({ ...SETTINGS, side: 'Back1' }, fold);
    expect(fold).toHaveBeenCalledTimes(2);
    await render({ ...SETTINGS, side: 'Back1', foldCase: 2 }, fold);
    expect(fold).toHaveBeenCalledTimes(3);
    // Each geometry is folded once for the dialog's life.
    await render(SETTINGS, fold);
    expect(fold).toHaveBeenCalledTimes(3);
  });

  it('stops folding when the settings go back to a fold it has while another still runs', async () => {
    let landBack!: () => void;
    const fold = vi.fn((settings: CreaseExportFoldedFigureSettings) =>
      settings.side === 'Front0'
        ? Promise.resolve(result(true, settings))
        : new Promise<CreaseExportFoldResult>((resolve) => {
            landBack = () => resolve(result(true, settings));
          })
    );
    await render(SETTINGS, fold);
    await render({ ...SETTINGS, side: 'Back1' }, fold);
    expect(shown!.folding).toBe(true);
    // Front again before Back lands: its fold is on show, and nothing it waits for is running.
    await render(SETTINGS, fold);
    expect(shown!.folding).toBe(false);
    await act(async () => landBack());
    expect(shown!.folding).toBe(false);
    expect(fold).toHaveBeenCalledTimes(2);
  });
});

describe('a preview fold in a chosen layer order', () => {
  it('shows the kernel’s own order when the chosen one is refused with no picture on show', async () => {
    const fold = vi.fn(async () => foldOf('pattern-1'));
    const foldInOrder = refusesOrder();
    await render(SETTINGS, fold, { foldInOrder, orderFor: lookup() });
    // An order chosen that the kernel will not draw: the picture there was stays, and says so.
    const orderFor = lookup(orderOn('pattern-1'));
    await render(SETTINGS, fold, { foldInOrder, orderFor });
    expect(foldInOrder).toHaveBeenCalledTimes(1);
    expect(drawn()).toBe('pattern-1');
    expect(shown!.orderRefused).toBe(true);

    // The figure off and on: nothing on show to keep, so the kernel's own order rather than none.
    await render(SETTINGS, fold, { enabled: false, foldInOrder, orderFor });
    expect(shown!.figure).toBeNull();
    await render(SETTINGS, fold, { foldInOrder, orderFor });
    expect(drawn()).toBe('pattern-1');
    expect(shown!.orderRefused).toBe(true);
    expect(shown!.folding).toBe(false);
    expect(fold).toHaveBeenCalledTimes(1);
  });

  it('folds another pattern in its own order, not the one chosen for the pattern folded before', async () => {
    const one = vi.fn(async () => foldOf('pattern-1'));
    const two = vi.fn(async () => foldOf('pattern-2'));
    const foldInOrder = foldsInOrder();
    const orderFor = lookup(orderOn('pattern-1'));
    await render(SETTINGS, one, { cacheKeyPrefix: '1', foldInOrder, orderFor });
    expect(drawn()).toBe('pattern-1 in its order');

    // Another pattern, with no order chosen for its creases: its own fold, in the kernel's order.
    await render(SETTINGS, two, { cacheKeyPrefix: '2', foldInOrder, orderFor });
    expect(two).toHaveBeenCalledTimes(1);
    expect(drawn()).toBe('pattern-2');
    expect(shown!.source?.digest).toBe('pattern-2');
    expect(shown!.order).toBeNull();

    // Back to the first: in its order again, from the cache.
    await render(SETTINGS, one, { cacheKeyPrefix: '1', foldInOrder, orderFor });
    expect(drawn()).toBe('pattern-1 in its order');
    expect(shown!.order?.key).toBe('order:pattern-1');
    expect(one).toHaveBeenCalledTimes(1);
    expect(foldInOrder).toHaveBeenCalledTimes(1);
  });

  it('shows a pattern’s own figure when its order is refused, not another pattern’s on show', async () => {
    const one = vi.fn(async () => foldOf('pattern-1'));
    const two = vi.fn(async () => foldOf('pattern-2'));
    const foldInOrder = refusesOrder();
    const orderFor = lookup(orderOn('pattern-1'));
    await render(SETTINGS, one, { cacheKeyPrefix: '1', foldInOrder, orderFor });
    await render(SETTINGS, two, { cacheKeyPrefix: '2', foldInOrder, orderFor });
    expect(drawn()).toBe('pattern-2');

    await render(SETTINGS, one, { cacheKeyPrefix: '1', foldInOrder, orderFor });
    expect(drawn()).toBe('pattern-1');
    expect(shown!.orderRefused).toBe(true);
  });

  it('shows the side asked for when its order is refused, not the other side on show', async () => {
    // The creases' digest is the same at either side; the snapshot says which side it is.
    const fold = vi.fn(async (settings: CreaseExportFoldedFigureSettings) => {
      const result = foldOf('pattern-1');
      return { ...result, snapshot: { primitives: [], drawn: settings.side } as unknown as OristudioCpFoldedRenderSnapshot };
    });
    const foldInOrder = refusesOrder();
    await render(SETTINGS, fold, { foldInOrder, orderFor: lookup() });
    const orderFor = lookup(orderOn('pattern-1'));
    await render(SETTINGS, fold, { foldInOrder, orderFor });
    expect(drawn()).toBe('Front0');
    expect(shown!.orderRefused).toBe(true);

    await render({ ...SETTINGS, side: 'Back1' }, fold, { foldInOrder, orderFor });
    expect(drawn()).toBe('Back1');
    expect(shown!.orderRefused).toBe(true);
    expect(fold.mock.calls.map(([settings]) => settings.side)).toEqual(['Front0', 'Back1']);
  });
});

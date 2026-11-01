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
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
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
});

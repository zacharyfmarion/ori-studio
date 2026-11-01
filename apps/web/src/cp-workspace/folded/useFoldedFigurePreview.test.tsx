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
import { IDENTITY_CP_MODEL_TO_FOLD, type CreaseExportFoldResult } from '../../lib/creaseExportFold';
import type { OristudioCpFoldedPaperScene, OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import { useFoldedFigurePreview, type FoldedFigurePreview } from './useFoldedFigurePreview';

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

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let shown: FoldedFigurePreview | null = null;

function Probe({
  settings,
  fold,
}: {
  settings: CreaseExportFoldedFigureSettings;
  fold: (settings: CreaseExportFoldedFigureSettings) => Promise<CreaseExportFoldResult>;
}) {
  const preview = useFoldedFigurePreview({ enabled: true, settings, fold, cacheKeyPrefix: '1' });
  useEffect(() => {
    shown = preview;
  });
  return null;
}

async function render(settings: CreaseExportFoldedFigureSettings, fold: Parameters<typeof Probe>[0]['fold']) {
  await act(async () => {
    root!.render(<Probe settings={settings} fold={fold} />);
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

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { effectivePaperStyle } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { folded3dAuxLinesOf } from './folded3dAuxLines';
import { folded3dRenderModel } from './folded3dRenderModels';
import { settledFolded3dFigureScene } from './folded3dStoredScene';
import { spatialAmount } from './folded3dSpread';

/** A save must not silently store yesterday's picture with today's recipe. */
export async function settledSpatialFigure(
  figure: OristudioCpFoldedFigureEntry,
  signal?: AbortSignal
): Promise<OristudioCpFoldedFigureEntry> {
  if (
    !figure.folded3d ||
    figure.handle == null ||
    (spatialAmount(figure) ?? 0) <= 0
  )
    return figure;
  const model = folded3dRenderModel(figure.handle);
  if (!model) throw new Error('Refold before saving a changed spatial spread');
  const scene = await settledFolded3dFigureScene(
    figure,
    model,
    {
      style: effectivePaperStyle(
        useSettingsStore.getState().paperStyle.display,
        figure.appearance
      ),
      space: 'document',
      aux: folded3dAuxLinesOf(figure.handle),
    },
    signal
  );
  if (scene?.items.some((item) => item.kind === 'markup'))
    throw new Error(
      'Spatial drawing exceeds the editable figure picture budget'
    );
  if (!scene) throw new Error('Spatial spread has no settled picture');
  return { ...figure, scene };
}
export function foldedFiguresWithSpatialScenes(
  figures: OristudioCpFoldedFigureEntry[]
): Promise<OristudioCpFoldedFigureEntry[]> {
  return Promise.all(figures.map((figure) => settledSpatialFigure(figure)));
}

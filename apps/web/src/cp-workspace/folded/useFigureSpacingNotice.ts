import { useMemo, useSyncExternalStore } from 'react';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { PropertyNotice } from '../../lib/propertyDescriptors';
import { useConnectedSpread } from '../../layer-spread/useConnectedSpread';
import { spacingUpdateText, spreadUpdate } from '../../layer-spread/spreadUpdate';
import { foldedFigureSpreadBlock, type FoldedFigureSpread } from './foldedFigureSpread';
import type { FoldedFigureSpreadStatus } from './foldedFigureSpreadStatus';
import { foldedFigureSpreadScene } from './foldedFlatSpreadScene';
import { foldedFlatScenes, subscribeFoldedFlatScenes } from './foldedFlatScenes';
import { folded3dRenderModel } from './folded3dRenderModels';
import { useSpatialOpeningGain } from './useSpatialFoldedMesh';

export function useFigureSpacingNotice(
  figure: OristudioCpFoldedFigureEntry,
  status: FoldedFigureSpreadStatus | null,
  held: boolean,
  setSpread: (spread: FoldedFigureSpread) => Promise<boolean | undefined>,
  t: TFunction,
): PropertyNotice | undefined {
  const recipe = figure.spread?.kind === 'record' ? figure.spread.spread : figure.spread;
  const legacy = foldedFigureSpreadBlock(figure, status) === null &&
    ((recipe?.kind === 'connected' && recipe.version < 3) || (recipe?.kind === 'spatial' && recipe.version === 1));
  const table = useSyncExternalStore(subscribeFoldedFlatScenes, foldedFlatScenes, foldedFlatScenes);
  const scene = legacy && recipe.kind === 'connected' ? foldedFigureSpreadScene(figure, table) : null;
  const { prepared } = useConnectedSpread(scene, !!scene);
  const model = legacy && recipe.kind === 'spatial' ? folded3dRenderModel(figure.handle) : undefined;
  const spatialGain = useSpatialOpeningGain(model);
  return useMemo(() => {
    if (!legacy) return undefined;
    const update = spreadUpdate(recipe, false, prepared, spatialGain);
    return {
      tone: 'info',
      text: spacingUpdateText(t, update?.capped === true),
      actions: [{
        id: 'update-spacing',
        label: t('panels:diagram.spread.equalOpeningUpdate', 'Update'),
        disabled: held || !update,
        run: async () => {
          if (held || !update) return;
          const changed = await setSpread(recipe.kind === 'spatial'
            ? { ...recipe, version: 2, amount: update.amount }
            : { kind: 'record', spread: { ...recipe, version: 3, amount: update.amount } });
          if (changed) {
            track(ANALYTICS_EVENTS.figureSpacingUpdated, { kind: recipe.kind, result: update.capped ? 'capped' : 'preserved' });
          }
        },
      }],
    };
  }, [legacy, recipe, prepared, spatialGain, held, setSpread, t]);
}

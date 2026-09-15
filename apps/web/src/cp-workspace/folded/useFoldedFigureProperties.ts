import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioCpFoldedFigureDisplayStyle } from '../../engine/oristudioCpTypes';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { buildFoldedFigureProperties, type FoldedFigurePropertyDeps } from './foldedFigureProperties';
import { isFoldedFigureStale } from './foldedFigureStaleness';
import { setFoldedFigureDisplayStyle } from './foldedFigureVerbs';

/**
 * The folded figure's sheet, bound to the store through the verbs module —
 * not `useFoldedFigures`, which is single-instance and needs the panel's
 * document and selection.
 */
export function useFoldedFigureProperties(target: TargetOf<'folded-figure'>): PropertySheet {
  const { t } = useTranslation();
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document);
  const figure = target.figure;
  // The same test the panel runs for its stale badge, once per document revision.
  const stale = useMemo(() => isFoldedFigureStale(document, figure), [document, figure]);
  const setDisplayStyle = useCallback(
    (style: OristudioCpFoldedFigureDisplayStyle) => {
      void setFoldedFigureDisplayStyle(target.id, style, t);
    },
    [target.id, t]
  );
  const deps = useMemo<FoldedFigurePropertyDeps>(
    () => ({ t, stale, setDisplayStyle }),
    [t, stale, setDisplayStyle]
  );
  return useMemo(() => buildFoldedFigureProperties(target, deps), [target, deps]);
}

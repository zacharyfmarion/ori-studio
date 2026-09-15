import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureDisplayStyle } from '../../engine/oristudioCpTypes';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { isFoldedFigureReady } from './foldedFigureActions';
import { FOLDED_DISPLAY_STYLE_OPTIONS, foldedDisplayStyleLabel } from './foldedFigureControlOptions';
import { foldedFigureSubtitle } from './foldedFigureNotice';

export interface FoldedFigurePropertyDeps {
  t: TFunction;
  /** Whether the figure's source creases have changed since it was folded. */
  stale: boolean;
  setDisplayStyle(style: OristudioCpFoldedFigureDisplayStyle): void;
}

/**
 * The properties of a folded figure the pane edits today: the display style,
 * through the verbs module. Side, colours, shadows, anti-alias, camera and
 * placement follow with the kernel write queue (Phase D of the plan). The
 * title is the figure's own and the subtitle its stale / case note — context,
 * not a field. A figure that is not ready (reopened, still folding, failed)
 * has nothing to draw with, so every appearance field is offered disabled
 * with the reason; Refold itself stays on the floating toolbar.
 */
export function buildFoldedFigureProperties(
  target: TargetOf<'folded-figure'>,
  deps: FoldedFigurePropertyDeps
): PropertySheet {
  const { t } = deps;
  const figure = target.figure;
  const ready = isFoldedFigureReady(figure);
  const notReady = t(
    'panels:cpProperties.folded.refoldToChange',
    'Refold to change how this figure looks'
  );
  return {
    kind: 'folded-figure',
    targetId: figure.id,
    title: figure.title,
    subtitle: foldedFigureSubtitle(t, figure, deps.stale),
    icon: 'folded-figure',
    sections: [
      {
        id: 'appearance',
        title: t('panels:cpProperties.folded.appearance', 'Appearance'),
        fields: [
          {
            id: 'displayStyle',
            kind: 'select',
            label: t('panels:cpProperties.folded.displayStyle', 'Display style'),
            support: ready ? 'supported' : 'unsupported',
            ...(ready ? {} : { reason: notReady }),
            undoLabel: t('panels:creasePattern.changeFoldedDisplayStyle', 'Change folded display style'),
            options: FOLDED_DISPLAY_STYLE_OPTIONS.map((style) => ({
              id: style,
              label: foldedDisplayStyleLabel(t, style),
            })),
            protocol: 'discrete',
            value: figure.displayStyle,
            commit: (next) => {
              if (next !== null) deps.setDisplayStyle(next as OristudioCpFoldedFigureDisplayStyle);
            },
          },
        ],
      },
    ],
  };
}

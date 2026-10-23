import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StepFilmstrip,
  type StepFilmstripProps,
  type StepFilmstripWays,
} from '../../components/steps/StepFilmstrip';
import type { ReferencesFilmstripStep } from './referencesFilmstrip';
import { StepDiagram } from './StepDiagram';

/**
 * References' folding steps as a diagram, along the top of the workspace: the
 * shared {@link StepFilmstrip} with ReferenceFinder's pictures and References'
 * words in it.
 *
 * The shape ReferenceFinder's own app uses. Selecting a step scrolls the strip,
 * never the camera: moving the crease pattern under the reader on every step
 * was the thing this replaced.
 *
 * **Windowed.** Each card draws every crease made up to its own step, so a
 * card costs about (its index / step count) of the whole pattern and the strip
 * as a whole costs about half of *steps × creases* — quadratic in plan length.
 * Measured over the corpus that is 219,617 SVG elements and 717 ms at p90, and
 * 705,595 elements and 2.66 s at p99, which is why the shared strip mounts only
 * the cards in view.
 */
export type ReferencesStepFilmstripProps = Omit<
  StepFilmstripProps<ReferencesFilmstripStep>,
  'renderThumbnail' | 'label' | 'waysLabel' | 'wayReadout'
>;

/**
 * A card's picture: ReferenceFinder's own diagram, or the primitives the
 * planner's step was drawn from. Module-level, so the strip sees one function
 * for the life of the app and redraws no picture for being re-rendered.
 */
function renderStepDiagram(step: ReferencesFilmstripStep) {
  const chrome = { number: step.number, badge: step.badge };
  return step.diagram ? (
    <StepDiagram diagram={step.diagram} size={100} chrome={chrome} />
  ) : (
    <StepDiagram
      primitives={step.primitives}
      size={100}
      mirrored={step.mirrored}
      chrome={chrome}
    />
  );
}

export const ReferencesStepFilmstrip = memo(function ReferencesStepFilmstrip(
  props: ReferencesStepFilmstripProps
) {
  const { t } = useTranslation();
  const wayReadout = useCallback(
    (way: StepFilmstripWays, short: boolean) =>
      short
        ? t('panels:references.ways.readoutShort', '{{n}} / {{total}}', {
            n: way.index + 1,
            total: way.count,
          })
        : t('panels:references.ways.readout', 'Way {{n}} of {{total}}', {
            n: way.index + 1,
            total: way.count,
          }),
    [t]
  );
  return (
    <StepFilmstrip
      {...props}
      renderThumbnail={renderStepDiagram}
      label={t('panels:references.filmstrip.label', 'Folding steps')}
      waysLabel={t('panels:references.ways.label', 'Ways to fold this step')}
      wayReadout={wayReadout}
    />
  );
});

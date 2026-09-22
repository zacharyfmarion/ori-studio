import type { OristudioCpFoldedFigureModel } from '../../engine/oristudioCpTypes';
import { rgbColorToHex } from '../rgbColor';
import {
  DEFAULT_PAPER_STYLE,
  ORIEDITA_LINE_COLOR,
  ORIEDITA_PAPER_BACK,
  ORIEDITA_PAPER_FRONT,
  hasPaperStyleOverrides,
  type PaperStyleOverrides,
} from './paperStyle';

/**
 * The overrides a folded figure from before the paper style amounts to.
 *
 * Such a figure's only appearance was its kernel model's three colours. A
 * figure whose colours are Oriedita's defaults is treated as following the app
 * style; any other colour was a deliberate recolouring and becomes a pin, so a
 * user adopting a style sees their old figures follow it and their recoloured
 * ones stay put (D1). `line_color` pins the whole edge pen — a pen is
 * overridden whole — at the default width with that colour.
 *
 * No model at all (a figure saved mid-fold) pins nothing.
 */
export function legacyPaperStyleOverrides(
  model: Pick<OristudioCpFoldedFigureModel, 'front_color' | 'back_color' | 'line_color'> | undefined
): PaperStyleOverrides | undefined {
  if (!model) return undefined;
  const overrides: PaperStyleOverrides = {};
  const front = rgbColorToHex(model.front_color);
  const back = rgbColorToHex(model.back_color);
  const line = rgbColorToHex(model.line_color);
  if (front !== ORIEDITA_PAPER_FRONT) overrides['paper.front'] = front;
  if (back !== ORIEDITA_PAPER_BACK) overrides['paper.back'] = back;
  if (line !== ORIEDITA_LINE_COLOR) overrides.edges = { ...DEFAULT_PAPER_STYLE.edges, color: line };
  return hasPaperStyleOverrides(overrides) ? overrides : undefined;
}

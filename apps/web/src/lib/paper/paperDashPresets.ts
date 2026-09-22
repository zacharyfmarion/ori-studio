/**
 * The dashes the Settings field offers by name.
 *
 * A dash is a list of run lengths in multiples of the pen's width
 * ({@link Pen.dash}), so the same list reads as the same pattern at any weight
 * — which is what lets a short list of names cover every pen. Anything not in
 * the list is still a dash, and the field says so rather than pretending it is
 * one of these: `dashPresetOf` answers `custom`.
 *
 * Deliberately separate from the crease-style switch's Oriedita runs
 * (`ORIEDITA_MOUNTAIN_DASH_MULTIPLES`): those are Oriedita's own patterns, kept
 * for parity with its crease pattern, and they are not offered here — a style
 * carrying them reads as `custom`, and the switch that writes them is untouched.
 */
import { dashEquals, type Pen } from './paperStyle';

export type DashPresetId = 'solid' | 'dashed' | 'dashDot' | 'dotted' | 'longDash' | 'fineDash';

/** A named dash, or `custom` for a pattern the list does not hold. */
export type DashChoice = DashPresetId | 'custom';

export interface DashPreset {
  id: DashPresetId;
  /** Run lengths in multiples of the pen's width, or null for solid. */
  dash: number[] | null;
}

/** The named dashes, in the order the menu lists them: solid first, then coarse to fine. */
export const DASH_PRESETS: readonly DashPreset[] = [
  { id: 'solid', dash: null },
  { id: 'dashed', dash: [4, 2] },
  { id: 'dashDot', dash: [8, 2, 1, 2] },
  { id: 'dotted', dash: [1, 2] },
  { id: 'longDash', dash: [12, 3] },
  { id: 'fineDash', dash: [2, 2] },
];

/** The named dash a pen is drawn with, or `custom`. */
export function dashPresetOf(pen: Pen): DashChoice {
  return DASH_PRESETS.find((preset) => dashEquals(preset.dash, pen.dash))?.id ?? 'custom';
}

/** A named dash's runs, or null for solid. A fresh array, so a caller may keep it. */
export function dashPresetRuns(id: DashPresetId): number[] | null {
  const preset = DASH_PRESETS.find((candidate) => candidate.id === id);
  return preset?.dash ? [...preset.dash] : null;
}

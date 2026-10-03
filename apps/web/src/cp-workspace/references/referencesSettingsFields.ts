/**
 * Every References setting, once: its type, and whether it changes the plan.
 *
 * The plan cache keys a plan on the settings that change it, and the saved
 * reader state reads the settings back by type. Both used to list the settings
 * by hand, so a seventh setting would have compiled everywhere and been left
 * out of both — a plan made under the other value of it served as a hit, and
 * the reader's choice never read back. This table is checked against
 * `ReferencesSettings` field for field, so a new setting does not compile until
 * it says what it is, and from then on it is in the key and in the file.
 */
import type { ReferencesSettings } from '../../store/workspaceStore/types';

export const REFERENCES_SETTING_FIELDS = {
  /** How many ReferenceFinder answers Find asks for: Find's, not the planner's. */
  candidateCount: { kind: 'number', plan: false },
  /** Whether Find accepts approximate answers: Find's, not the planner's. */
  includeApproximate: { kind: 'boolean', plan: false },
  precreaseGrid: { kind: 'boolean', plan: true },
  gridWhereNeeded: { kind: 'boolean', plan: true },
  allowDanglingFolds: { kind: 'boolean', plan: true },
  mergeSymmetricSteps: { kind: 'boolean', plan: true },
} as const satisfies Record<
  keyof ReferencesSettings,
  { kind: 'number' | 'boolean'; plan: boolean }
>;

type Fields = typeof REFERENCES_SETTING_FIELDS;

/** The settings that change a plan itself, rather than how anything is asked for or shown. */
export type ReferencesPlanSettingKey = {
  [K in keyof Fields]: Fields[K]['plan'] extends true ? K : never;
}[keyof Fields];

export type ReferencesPlanSettings = Pick<ReferencesSettings, ReferencesPlanSettingKey>;

export const REFERENCES_SETTING_KEYS = Object.keys(REFERENCES_SETTING_FIELDS) as (keyof Fields)[];

export const REFERENCES_PLAN_SETTING_KEYS = REFERENCES_SETTING_KEYS.filter(
  (key): key is ReferencesPlanSettingKey => REFERENCES_SETTING_FIELDS[key].plan
);

/** Just the plan's settings, out of any record that has them. */
export function planSettingsOf(settings: ReferencesPlanSettings): ReferencesPlanSettings {
  return Object.fromEntries(
    REFERENCES_PLAN_SETTING_KEYS.map((key) => [key, settings[key]])
  ) as unknown as ReferencesPlanSettings;
}

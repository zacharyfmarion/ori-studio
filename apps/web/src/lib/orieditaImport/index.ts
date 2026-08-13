/**
 * Reading an Oriedita `.oriconfig` export into a reviewable set of Ori Studio
 * keybindings.
 *
 * The pipeline is four pure steps, each usable on its own and each tested on its
 * own: unzip the archive, parse the `hotkey.properties` inside it, turn each
 * Java keystroke into a chord, and plan what applying them would do.
 *
 *   readOriconfigArchive -> parseJavaProperties -> buildOrieditaImportPlan
 *
 * `parseOrieditaKeyStrokeStrict` is exported alongside because the plan reports
 * its rejection reasons per row, and the UI needs the type to word them.
 * Nothing here touches the store: `buildOrieditaImportPlan` returns the override
 * set, and applying it is the caller's decision.
 */
export {
  readOriconfigArchive,
  type OriconfigArchiveFailure,
  type OriconfigArchiveFailureReason,
  type OriconfigArchiveRead,
  type OriconfigArchiveResult,
  type OriconfigEntryName,
  type UnsupportedOriconfigEntry,
} from './oriconfigArchive';

export { parseJavaProperties, type JavaPropertyValue } from './javaProperties';

export {
  parseOrieditaKeyStrokeStrict,
  type KeyStrokeRejectReason,
  type ParsedKeyStroke,
} from './parseKeyStroke';

/**
 * Upstream's own layout. Not part of the import path — an import carries the
 * user's edits only — but the input `keyboard/shortcuts.ts` derives the
 * `oriedita` defaults source from.
 */
export { ORIEDITA_DEFAULT_HOTKEYS } from './orieditaDefaultHotkeys.generated';

export {
  buildOrieditaImportPlan,
  type OrieditaImportOutcome,
  type OrieditaImportEviction,
  type OrieditaImportPlan,
  type OrieditaImportPlanInput,
  type OrieditaImportRow,
  type OrieditaImportRowDetail,
  type OrieditaImportShadowing,
  type OrieditaImportSkipReason,
} from './importPlan';

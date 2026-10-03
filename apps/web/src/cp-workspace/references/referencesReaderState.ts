/**
 * The reader's References state as a project file keeps it: the settings, the
 * mode, which sheet, Landmarks first, and which card was open.
 *
 * Everything here is the reader's, and none of it is invalidated by a planner
 * change — the plan itself is the plan cache's (`referencesPlanCache`). Two
 * things are named by *where they are* rather than by an index, because the
 * index would not survive the reopen:
 *
 * - **the sheet by its bounds**, since a component id numbers one run of the
 *   frames analysis;
 * - **the card by its line**, since a replan may number the cards
 *   differently. The index is kept as a hint, to choose between cards on the
 *   same line (a fold and the presses that carry it on) and to place a card
 *   that has no line — a turn-over, the finished pattern.
 *
 * Pure: no React, no store.
 */
import type {
  ReferencesMode,
  ReferencesSettings,
  ReferencesTarget,
  ReferencesView,
} from '../../store/workspaceStore/types';
import type { PrecreasePlanLine } from './precreaseSequence';
import { flatPlanSteps, planIsForSheet } from './referencesBreakdown';
import type { ReferencesFrames, ReferencesPlanRecord, ReferencesPlanVariant } from './referencesResults';
import { referencesViewSteps, type ReferencesViewStep } from './referencesSequenceView';
import { sameSheetBounds, sheetBounds } from './referencesSheets';
import type { ModelBounds } from './referencesStepGeometry';
import { presentedVariants } from './referencesWays';
import type { SheetAnalysis } from './sheetFrames';

/** A sheet, by where it is. */
export interface ReferencesSheetLocator {
  bounds: ModelBounds;
}

/** A card of the sequence, by the fold it makes. */
export interface ReferencesCardLocator {
  /** Its place in the strip when saved: exact against the same plan, a hint against another. */
  index: number;
  /** The fold's line; null for a card that makes none — a turn-over, the finished pattern. */
  line: PrecreasePlanLine | null;
}

/** The reader's References state, as `creasePattern.viewState.references` holds it. */
export interface ReferencesReaderStateV1 {
  v: 1;
  /**
   * The six settings. All six are written; a reader takes those it can read
   * and leaves the rest as they are.
   */
  settings: Partial<ReferencesSettings>;
  mode: ReferencesMode;
  /** Null: whichever sheet the workspace falls back to. */
  sheet: ReferencesSheetLocator | null;
  landmarksFirst: boolean;
  /** Null: the first card. */
  activeCard: ReferencesCardLocator | null;
}

/**
 * What an open restored and has not yet been able to place: the sheet waits
 * for the frames analysis, the card for the plan. Held in the store for the
 * document it was read with — `loadSerial` — and for no other.
 */
export interface ReferencesRestore {
  loadSerial: number;
  sheet: ReferencesSheetLocator | null;
  card: ReferencesCardLocator | null;
}

/**
 * Whether a revision (`referencesRevisionKey`: `${loadSerial}:${fingerprint}`)
 * is of document load `loadSerial` — that document, edited or not. A save asks
 * it of the frames and the plan it describes the workspace from: a sheet
 * chosen before the last edit is still the sheet chosen.
 */
export function revisionIsOfLoad(revision: string, loadSerial: number): boolean {
  return revision.startsWith(`${loadSerial}:`);
}

/** The sheet of `frames` at `locator`'s bounds, or null when there is none there now. */
export function locateSheet(frames: SheetAnalysis, locator: ReferencesSheetLocator): number | null {
  const found = frames.components.find((component) => {
    const bounds = sheetBounds(component);
    return bounds !== null && sameSheetBounds(bounds, locator.bounds);
  });
  return found?.id ?? null;
}

const LINE_SLACK = 1e-9;

function sameLine(a: PrecreasePlanLine, b: PrecreasePlanLine): boolean {
  return (
    Math.abs(a.n[0] - b.n[0]) <= LINE_SLACK &&
    Math.abs(a.n[1] - b.n[1]) <= LINE_SLACK &&
    Math.abs(a.d - b.d) <= LINE_SLACK
  );
}

/** The lines a card folds: its step's, and its twin's when it has one. */
function cardLines(
  variants: readonly ReferencesPlanVariant[],
  view: ReferencesViewStep
): PrecreasePlanLine[] {
  if (view.kind !== 'fold') return [];
  const steps = variants[view.component]?.sequence.steps;
  const lines = [steps?.[view.step]?.line];
  if (view.twin !== undefined) lines.push(steps?.[view.twin]?.line);
  return lines.filter((line): line is PrecreasePlanLine => line !== undefined);
}

/** The card at `index` of the strip, as a locator; null for no card there. */
export function cardLocatorAt(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  index: number
): ReferencesCardLocator | null {
  const view = viewSteps[index];
  if (!view) return null;
  const [line] = cardLines(variants, view);
  return { index, line: line ? { n: [line.n[0], line.n[1]], d: line.d } : null };
}

/**
 * Where `locator`'s card is in this strip: the card folding its line — the
 * nearest to the hint, when more than one does — or, for a card with no line,
 * the hint itself if a lineless card is still there. The first card when
 * neither finds it: the plan has changed under the locator, and the card it
 * named is not in it.
 */
export function locateCard(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  locator: ReferencesCardLocator
): number {
  const { line } = locator;
  if (line === null) {
    const view = viewSteps[locator.index];
    return view && view.kind !== 'fold' ? locator.index : 0;
  }
  let best = 0;
  let bestDistance = Infinity;
  viewSteps.forEach((view, index) => {
    if (!cardLines(variants, view).some((candidate) => sameLine(candidate, line))) return;
    const distance = Math.abs(index - locator.index);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** The strip a plan record reads as, with the toggle and the chosen ways applied. */
export function planStrip(
  record: ReferencesPlanRecord,
  view: Pick<ReferencesView, 'landmarksFirst' | 'planWays'>
): { variants: ReferencesPlanVariant[]; viewSteps: ReferencesViewStep[] } {
  const variants = presentedVariants(record, view.landmarksFirst, view.planWays);
  const flat = flatPlanSteps(variants.map((variant) => variant.sequence));
  return { variants, viewSteps: referencesViewSteps(variants, flat) };
}

/** Everything a save describes the workspace from. */
export interface ReferencesReaderStateSource {
  settings: ReferencesSettings;
  defaults: ReferencesSettings;
  view: ReferencesView;
  selectedSheet: number | null;
  target: ReferencesTarget | null;
  restore: ReferencesRestore | null;
  /** The document being saved. */
  loadSerial: number;
  /** The side table's frames and plan, whichever revision they are of. */
  frames: ReferencesFrames | null;
  plan: ReferencesPlanRecord | null;
}

function sameSettings(a: ReferencesSettings, b: ReferencesSettings): boolean {
  return (
    a.candidateCount === b.candidateCount &&
    a.includeApproximate === b.includeApproximate &&
    a.precreaseGrid === b.precreaseGrid &&
    a.gridWhereNeeded === b.gridWhereNeeded &&
    a.allowDanglingFolds === b.allowDanglingFolds &&
    a.mergeSymmetricSteps === b.mergeSymmetricSteps
  );
}

/**
 * The reader state to save, or null when there is nothing to say — the
 * defaults, in Find, on whichever sheet comes first.
 *
 * What an open restored and the workspace has not yet placed is written back
 * as it was read: a file reopened and saved without a visit to References
 * keeps its sheet and its card.
 */
export function referencesReaderStateFor(
  source: ReferencesReaderStateSource
): ReferencesReaderStateV1 | null {
  const restore = source.restore?.loadSerial === source.loadSerial ? source.restore : null;

  let sheet: ReferencesSheetLocator | null = restore?.sheet ?? null;
  if (!sheet && source.selectedSheet !== null && source.frames) {
    const component = revisionIsOfLoad(source.frames.revision, source.loadSerial)
      ? source.frames.analysis.components.find((entry) => entry.id === source.selectedSheet)
      : undefined;
    const bounds = component ? sheetBounds(component) : null;
    sheet = bounds ? { bounds } : null;
  }

  let activeCard: ReferencesCardLocator | null = restore?.card ?? null;
  const targeted = source.target !== null && source.target.kind !== 'whole';
  const plan = source.plan;
  if (
    !activeCard &&
    !targeted &&
    plan &&
    revisionIsOfLoad(plan.revision, source.loadSerial) &&
    planIsForSheet(plan, source.selectedSheet)
  ) {
    const { variants, viewSteps } = planStrip(plan, source.view);
    const index = Math.max(0, Math.min(viewSteps.length - 1, source.view.activeStep));
    activeCard = cardLocatorAt(variants, viewSteps, index);
  }

  const state: ReferencesReaderStateV1 = {
    v: 1,
    settings: { ...source.settings },
    mode: source.view.mode,
    sheet,
    landmarksFirst: source.view.landmarksFirst,
    activeCard,
  };
  const saysNothing =
    state.mode === 'find' &&
    !state.landmarksFirst &&
    state.sheet === null &&
    state.activeCard === null &&
    sameSettings(source.settings, source.defaults);
  return saysNothing ? null : state;
}

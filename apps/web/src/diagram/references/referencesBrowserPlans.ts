/**
 * What the Diagram's References browser offers (D20): the patterns with a
 * plan that still fits their creases, and each plan's cards as the steps they
 * would become. Drawn as References draws them — the same chain, from the
 * same cached plan — so a card pulled into the diagram is the card References
 * shows.
 *
 * Pure: no store, no worker.
 */
import type { TFunction } from 'i18next';
import { referencesSheetAux, type ReferencesSheetAux } from '../../cp-workspace/references/referencesAuxCreases';
import { cachedPlanRecord, planVariantInModel } from '../../cp-workspace/references/referencesCachedPlanRecord';
import {
  referencesDiagramCard,
  type ReferencesDiagramCard,
  type ReferencesStripContext,
} from '../../cp-workspace/references/referencesDiagramCards';
import { candidateFilmstrip, planFilmstrip } from '../../cp-workspace/references/referencesFilmstrip';
import {
  REFERENCES_PLANNER_BUILD,
  referencesPlanCacheKeyId,
  samePlanSheet,
  sheetFingerprint,
  type ReferencesCachedPlan,
} from '../../cp-workspace/references/referencesPlanCache';
import type { ReferencesPlanCacheListing } from '../../cp-workspace/references/referencesPlanCacheStore';
import { planStrip } from '../../cp-workspace/references/referencesReaderState';
import type { ReferencesCandidateResult, ReferencesResults } from '../../cp-workspace/references/referencesResults';
import { referencesSheets, sheetBounds } from '../../cp-workspace/references/referencesSheets';
import { chosenWitness } from '../../cp-workspace/references/precreaseSequence';
import { rfSheetOfFrame } from '../../cp-workspace/references/referenceFinderStepInModel';
import { stepWays, waySignature, wayChoicesOfSheet } from '../../cp-workspace/references/referencesWays';
import type { PrecreaseComponent, PrecreaseInput, SheetAnalysis } from '../../cp-workspace/references/sheetFrames';
import { boundariesMatch } from '../../cp-workspace/regions/regionReference';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { Point } from '../../lib/geometry';
import type { DiagramStepDiagramPicture, ReferencesPlanSettings } from '../document/diagramDocument';
import { referencesCardPicture } from './referencesPulledSteps';

/** A pattern the browser lists: one of References' sheets, with a plan that fits it now. */
export interface BrowserPattern {
  /** The plan's cache key, as one string: the pattern's name in the browser and in a pulled step. */
  id: string;
  /** "Pattern N", as References' rail numbers its sheets. */
  number: number;
  component: PrecreaseComponent;
  listing: ReferencesPlanCacheListing;
}

/**
 * The patterns with a plan to offer, in References' order: each of its
 * sheets whose cached plan is this planner's and was made from its creases
 * as they are now. A sheet edited since its plan, or planned by another
 * build, is not listed — References plans it again when it is shown there.
 */
export function plannedPatterns(
  analysis: SheetAnalysis,
  listing: readonly ReferencesPlanCacheListing[],
  input: PrecreaseInput
): BrowserPattern[] {
  const current = listing.filter(
    (entry) =>
      entry.key.planner === REFERENCES_PLANNER_BUILD &&
      entry.key.sheet.fingerprint === sheetFingerprint(input, entry.key.sheet.bounds)
  );
  return referencesSheets(analysis).flatMap((sheet, index) => {
    const component = analysis.components.find((candidate) => candidate.id === sheet.id);
    const bounds = component ? sheetBounds(component) : null;
    if (!component?.frame || !bounds) return [];
    const frame = component.frame;
    const entry = current.find((candidate) => samePlanSheet(candidate.key.sheet, { bounds, frame, fingerprint: '' }));
    return entry ? [{ id: referencesPlanCacheKeyId(entry.key), number: index + 1, component, listing: entry }] : [];
  });
}

/** A card of a plan or a Find answer, and the step it would become. */
export interface BrowserCard {
  /** Its row in the strip: what a selection names. */
  index: number;
  kind: 'fold' | 'turn-over' | 'done';
  /** The number the strip prints; null for a turn-over or the ending. */
  number: number | null;
  /** What a card that is not an ordinary fold is, or must tell (approximate, a grid pleat). */
  badge: string;
  sentence: string;
  /** How many ways the card's fold can be made, when more than one. */
  ways: number | null;
  /** The step it becomes; null when its picture does not read, and it cannot be added. */
  step: { card: ReferencesDiagramCard; picture: DiagramStepDiagramPicture; way: string | null } | null;
}

/** A plan's cards, and what the browser says about the plan. */
export interface BrowserPlan {
  cards: BrowserCard[];
  /** The plan ran to its end: only then is its Finished card offered. */
  finished: boolean;
  settings: ReferencesPlanSettings;
}

/**
 * A pattern's cached plan as cards, under the reader's Landmarks first and
 * the ways chosen in the plan, its sheet's aux lines drawn on every card.
 * Throws what the chain throws for a plan this build cannot read.
 */
export function browserPlanCards(
  t: TFunction,
  plan: ReferencesCachedPlan,
  pattern: BrowserPattern,
  geometry: CpGeometryTransport,
  landmarksFirst: boolean,
  revision: string
): BrowserPlan {
  const { key } = pattern.listing;
  const frame = key.sheet.frame;
  const record = cachedPlanRecord(plan, key, pattern.component.id, revision, {
    plain: planVariantInModel(plan.plain, frame),
    hoisted: planVariantInModel(plan.hoisted, frame),
  });
  // The plan's one sheet is variant 0 — what each card's view step names.
  const strip = planStrip(record, { landmarksFirst, planWays: wayChoicesOfSheet(pattern.listing.ways, 0) });
  const aux = referencesSheetAux(pattern.component, geometry);
  const sheetAux: ReferencesSheetAux | null = aux ? { ...aux, component: 0 } : null;
  const filmstrip = planFilmstrip(t, strip.variants, strip.viewSteps, [plan.result.stopReason], sheetAux);
  const context: ReferencesStripContext = { strip: filmstrip, viewSteps: strip.viewSteps, variants: strip.variants };
  const cards = filmstrip.map((row, index): BrowserCard => {
    const view = strip.viewSteps[index];
    const step =
      view?.kind === 'fold' ? strip.variants[view.component]?.sequence.steps[view.step] : undefined;
    const witness = step && stepWays(step).length > 0 ? chosenWitness(step) : null;
    return cardOf(context, index, witness ? waySignature(witness) : null);
  });
  return { cards, finished: plan.result.stopReason === 'complete', settings: { ...key.settings } };
}

/** The Find answer References has on screen, as cards: the candidate it shows. */
export function browserFindCards(
  t: TFunction,
  results: ReferencesResults,
  candidate: ReferencesCandidateResult
): BrowserCard[] {
  const strip = candidateFilmstrip(t, candidate, rfSheetOfFrame(results.frame));
  const context: ReferencesStripContext = { strip, viewSteps: [], variants: [] };
  return strip.map((_, index) => cardOf(context, index, null));
}

function cardOf(context: ReferencesStripContext, index: number, way: string | null): BrowserCard {
  const row = context.strip[index]!;
  const made = referencesDiagramCard(context, index);
  const card = made.status === 'ok' ? made.cards[0]! : null;
  const picture = card ? referencesCardPicture(card) : null;
  return {
    index,
    kind: row.kind,
    number: row.number,
    badge: row.badge,
    sentence: row.sentence,
    ways: row.ways?.count ?? null,
    step: card && picture ? { card, picture, way } : null,
  };
}

/**
 * The listed pattern on a sheet, by its rim: where a replaced step's own plan
 * is no longer listed — planned again since, under another key — its sheet's
 * current plan, not the first listed.
 */
export function sheetPattern<T extends Pick<BrowserPattern, 'component'>>(
  listed: readonly T[],
  sheet: Point[][] | null | undefined
): T | undefined {
  if (!sheet || sheet.length === 0) return undefined;
  return listed.find((candidate) => boundariesMatch([candidate.component.outline.map(([x, y]) => ({ x, y }))], sheet));
}

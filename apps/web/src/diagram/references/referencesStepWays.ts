/**
 * A References step's other ways to fold (D23): its card, drawn again from
 * its pattern's cached plan under each way the planner found for it, as
 * References draws a card under the way its reader chose.
 *
 * A step keeps the picture of one way, not the plan, so the plan has to be
 * the one it came from, still cached and still fitting its sheet: the browser
 * lists exactly those (`plannedPatterns`). The step does not record whether
 * its plan was read Landmarks first, which draws a card's earlier creases
 * differently; it is the order in which its own way draws its own picture.
 *
 * Pure: no store, no worker.
 */
import type { TFunction } from 'i18next';
import { stepWays, waySignature, withWayChoice, wayChoicesOfSheet } from '../../cp-workspace/references/referencesWays';
import type { ReferencesCachedPlan } from '../../cp-workspace/references/referencesPlanCache';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  stepDiagramKey,
  type DiagramReferencesSource,
  type DiagramStepDiagramPicture,
} from '../document/diagramDocument';
import { foldStepOf, planCards, PLAN_SHEET, type BrowserCard, type BrowserPattern } from './referencesBrowserPlans';
import { sameLine } from './referencesBrowserSelection';

/** One way the step's card can be folded, drawn. */
export interface ReferencesStepWay {
  /** The way's signature (`waySignature`), as a step records it. */
  signature: string;
  /** The card's picture under this way, on the side the step shows. */
  picture: DiagramStepDiagramPicture;
  /** The card's sentence under this way: the instruction it would have. */
  sentence: string;
}

export type ReferencesStepWays =
  /** One way only, or a card the plan no longer has: nothing to choose. */
  | { status: 'none' }
  | { status: 'ready'; ways: ReferencesStepWay[]; /** The way the step shows now. */ current: number };

/**
 * The ways a References step's card can be folded, from its plan: each
 * drawn, the one it shows marked. None for a card that folds no line, a card
 * the plan does not have, or one with a single way.
 */
export function referencesStepWays(
  t: TFunction,
  plan: ReferencesCachedPlan,
  pattern: BrowserPattern,
  geometry: CpGeometryTransport,
  revision: string,
  source: Pick<DiagramReferencesSource, 'line' | 'way'>,
  shown: Pick<DiagramStepDiagramPicture, 'key' | 'mirrored'>
): ReferencesStepWays {
  const { line } = source;
  if (!line) return { status: 'none' };
  const base = wayChoicesOfSheet(pattern.listing.ways, PLAN_SHEET);
  const cardOn = (cards: readonly BrowserCard[]) =>
    cards.findIndex((card) => card.kind === 'fold' && sameLine(card.step?.card.line ?? null, line));
  const keyOf = (picture: Pick<DiagramStepDiagramPicture, 'key'>) => stepDiagramKey(picture.key, false);

  const readings = [false, true].flatMap((landmarksFirst) => {
    const { cards, strip } = planCards(t, plan, pattern, geometry, revision, { landmarksFirst, planWays: base });
    const index = cardOn(cards);
    const step = index >= 0 ? foldStepOf(strip, index) : undefined;
    const ways = step ? stepWays(step) : [];
    if (!step || ways.length === 0) return [];
    const drawn = ways.flatMap((way, wayIndex): ReferencesStepWay[] => {
      const choices = withWayChoice(base, componentOf(strip, index), step, wayIndex);
      const { cards: under } = planCards(t, plan, pattern, geometry, revision, { landmarksFirst, planWays: choices });
      const card = under[cardOn(under)];
      if (!card?.step) return [];
      const { picture } = card.step;
      return [
        {
          signature: waySignature(way.witness),
          picture: { ...picture, mirrored: shown.mirrored, key: stepDiagramKey(picture.key, shown.mirrored) },
          sentence: card.sentence,
        },
      ];
    });
    return drawn.length === ways.length ? [{ landmarksFirst, ways: drawn }] : [];
  });
  if (readings.length === 0) return { status: 'none' };
  // The reading in which some way draws the step's own picture: the order it was pulled in.
  const own = readings.find((reading) => reading.ways.some((way) => keyOf(way.picture) === keyOf(shown))) ?? readings[0]!;
  const bySignature = own.ways.findIndex((way) => way.signature === source.way);
  const byPicture = own.ways.findIndex((way) => keyOf(way.picture) === keyOf(shown));
  return { status: 'ready', ways: own.ways, current: bySignature >= 0 ? bySignature : Math.max(0, byPicture) };
}

/** The plan sheet a fold row's step is on. */
function componentOf(strip: ReturnType<typeof planCards>['strip'], index: number): number {
  const view = strip.viewSteps[index];
  return view?.kind === 'fold' ? view.component : PLAN_SHEET;
}

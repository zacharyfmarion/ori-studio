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
import { foldStepOf, planCards, PLAN_SHEET, type BrowserPattern } from './referencesBrowserPlans';
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
 *
 * The card is the one on the step's line whose drawing under one of its ways
 * is the step's own picture: a press shares its fold's line, and its ways, so
 * the line alone can name the fold instead. The card the step recorded is
 * tried first. With no card and reading that draws the step's picture, there
 * is nothing to offer: another card's drawings are not the step's ways.
 */
export function referencesStepWays(
  t: TFunction,
  plan: ReferencesCachedPlan,
  pattern: BrowserPattern,
  geometry: CpGeometryTransport,
  revision: string,
  source: Pick<DiagramReferencesSource, 'line' | 'way' | 'card'>,
  shown: Pick<DiagramStepDiagramPicture, 'key' | 'mirrored'>
): ReferencesStepWays {
  const { line } = source;
  if (!line) return { status: 'none' };
  const base = wayChoicesOfSheet(pattern.listing.ways, PLAN_SHEET);
  const keyOf = (picture: Pick<DiagramStepDiagramPicture, 'key'>) => stepDiagramKey(picture.key, false);

  for (const landmarksFirst of [false, true]) {
    const { cards, strip } = planCards(t, plan, pattern, geometry, revision, { landmarksFirst, planWays: base });
    const onLine = cards
      .filter((card) => card.kind === 'fold' && sameLine(card.step?.card.line ?? null, line))
      .sort((a, b) => Number(b.number === source.card) - Number(a.number === source.card));
    for (const card of onLine) {
      const ways = drawWays(card.index);
      if (ways && ways.some((way) => keyOf(way.picture) === keyOf(shown))) {
        const bySignature = ways.findIndex((way) => way.signature === source.way);
        const byPicture = ways.findIndex((way) => keyOf(way.picture) === keyOf(shown));
        return { status: 'ready', ways, current: bySignature >= 0 ? bySignature : byPicture };
      }
    }

    /** The card at `index` drawn under each of its ways, on the side the step shows; null when it has one. */
    function drawWays(index: number): ReferencesStepWay[] | null {
      const step = foldStepOf(strip, index);
      const ways = step ? stepWays(step) : [];
      if (!step || ways.length === 0) return null;
      const drawn = ways.flatMap((way, wayIndex): ReferencesStepWay[] => {
        const choices = withWayChoice(base, componentOf(strip, index), step, wayIndex);
        const under = planCards(t, plan, pattern, geometry, revision, { landmarksFirst, planWays: choices }).cards[index];
        if (!under?.step || !sameLine(under.step.card.line, line)) return [];
        const { picture } = under.step;
        return [
          {
            signature: waySignature(way.witness),
            picture: { ...picture, mirrored: shown.mirrored, key: stepDiagramKey(picture.key, shown.mirrored) },
            sentence: under.sentence,
          },
        ];
      });
      return drawn.length === ways.length ? drawn : null;
    }
  }
  return { status: 'none' };
}

/** The plan sheet a fold row's step is on. */
function componentOf(strip: ReturnType<typeof planCards>['strip'], index: number): number {
  const view = strip.viewSteps[index];
  return view?.kind === 'fold' ? view.component : PLAN_SHEET;
}

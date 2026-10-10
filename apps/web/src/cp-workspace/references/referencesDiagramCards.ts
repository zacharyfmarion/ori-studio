/**
 * The step strip's cards as the Diagram takes them (diagram-workspace plan,
 * D6): what the Diagram's References browser pulls (D20).
 *
 * Taken from the strip's own rows, never from the export's model-frame
 * diagrams: a row already reflects the reader's chosen ways and twins, and is
 * the unit-frame picture the card draws, with the side it is seen from and the
 * sentence under it. A ReferenceFinder step arrives as the core's own diagram
 * and goes through the one adapter the card uses; a diagram the adapter
 * refuses is reported, never sent as a blank step.
 *
 * Pure: no React, no store.
 */
import type { PrecreasePlanLine } from './precreaseSequence';
import type { ReferencesFilmstripStep } from './referencesFilmstrip';
import {
  StepDiagramAdapterError,
  referenceFinderDiagramToPrimitives,
  type StepDiagramModel,
} from './referenceFinderDiagramToPrimitives';
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';

/** One card, as a diagram step is made from it. */
export interface ReferencesDiagramCard {
  kind: ReferencesFilmstripStep['kind'];
  /** The card's picture, in the unit frame. */
  model: StepDiagramModel;
  /** The card shows the paper's back. */
  mirrored: boolean;
  /** The sentence under the card: the step's instruction until it is edited. */
  sentence: string;
  /** The number the strip prints on the card; null for a turn-over or the ending. */
  card: number | null;
  /** The plan step's line, in the unit frame; null for a card that folds none. */
  line: PrecreasePlanLine | null;
}

export type ReferencesDiagramCards =
  | { status: 'ok'; cards: ReferencesDiagramCard[] }
  /** Nothing to send: no card, or (for one) not a card with a picture. */
  | { status: 'none' }
  /** ReferenceFinder's diagram did not read; nothing is sent. */
  | { status: 'unreadable' };

/** What the strip is showing, for pairing a row with the plan step under it. */
export interface ReferencesStripContext {
  strip: readonly ReferencesFilmstripStep[];
  /** The plan's view steps, row for row with the strip; empty in Find. */
  viewSteps: readonly ReferencesViewStep[];
  variants: readonly ReferencesPlanVariant[];
}

/** The card at `index`. `none` when the strip has no card there. */
export function referencesDiagramCard(
  context: ReferencesStripContext,
  index: number
): ReferencesDiagramCards {
  const row = context.strip[index];
  if (!row) return { status: 'none' };
  const card = diagramCard(context, row, index);
  return card ? { status: 'ok', cards: [card] } : { status: 'unreadable' };
}

/**
 * Every card of the strip, in order — except the ending, whose sentence is
 * about the plan (complete, stopped, out of ideas) rather than a fold. One
 * card that does not read refuses the lot: a sequence with a hole in it is not
 * the sequence.
 */
export function referencesDiagramCards(context: ReferencesStripContext): ReferencesDiagramCards {
  const cards: ReferencesDiagramCard[] = [];
  for (const [index, row] of context.strip.entries()) {
    if (row.kind === 'done') continue;
    const card = diagramCard(context, row, index);
    if (!card) return { status: 'unreadable' };
    cards.push(card);
  }
  return cards.length === 0 ? { status: 'none' } : { status: 'ok', cards };
}

function diagramCard(
  context: ReferencesStripContext,
  row: ReferencesFilmstripStep,
  index: number
): ReferencesDiagramCard | null {
  const model = rowModel(row);
  if (!model) return null;
  return {
    kind: row.kind,
    model,
    mirrored: row.mirrored,
    sentence: row.sentence,
    card: row.number,
    line: planLine(context, row, index),
  };
}

/** A row's picture: ours as it is, ReferenceFinder's through the adapter. Null when that refuses it. */
function rowModel(row: ReferencesFilmstripStep): StepDiagramModel | null {
  if (row.primitives) return row.primitives;
  if (!row.diagram) return null;
  try {
    return referenceFinderDiagramToPrimitives(row.diagram);
  } catch (error) {
    if (error instanceof StepDiagramAdapterError) return null;
    throw error;
  }
}

/**
 * The plan step a fold card makes, by the view step under it. The strip is
 * built row for row from the view steps, and every view step names a variant
 * the plan has; a pair that disagrees on what the card is gets no line rather
 * than another card's.
 */
function planLine(
  context: ReferencesStripContext,
  row: ReferencesFilmstripStep,
  index: number
): PrecreasePlanLine | null {
  const view = context.viewSteps[index];
  if (row.kind !== 'fold' || view?.kind !== 'fold') return null;
  const step = context.variants[view.component]?.sequence.steps[view.step];
  return step ? { n: [step.line.n[0], step.line.n[1]], d: step.line.d } : null;
}

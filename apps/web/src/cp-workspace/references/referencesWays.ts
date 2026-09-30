/**
 * The other ways a card can be folded, and the reader's choice among them.
 *
 * The planner offers them (`PrecreaseStep.ways`, `crates/oristudio-precrease/
 * src/order/ways.rs`): each is another construction of the same crease that
 * leaves the paper as the plan has it, so taking one changes that card and
 * nothing else. That is what makes a choice this module's business alone: the
 * sequence the workspace shows is the planned one with the chosen ways swapped
 * into their steps, and everything that draws, describes or animates a step
 * reads it through `chosenWitness`, `also` and `alignment` as before.
 *
 * Pure: no React, no store.
 */
import {
  chosenWitness,
  type PrecreaseRef,
  type PrecreaseSequence,
  type PrecreaseStep,
  type PrecreaseWay,
  type PrecreaseWitness,
} from './precreaseSequence';
import { cardTwin } from './referencesSequenceView';

/** The reader's ways: a {@link waySignature} per {@link wayKey}. */
export type ReferencesWayChoices = Readonly<Record<string, string>>;

function refSignature(ref: PrecreaseRef): string {
  switch (ref.kind) {
    case 'edge':
      return `e${ref.id}`;
    case 'corner':
      return `c${ref.id}`;
    case 'line':
      return `l${ref.id}`;
    case 'point':
      return `p${ref.id}`;
  }
}

/**
 * A construction as a choice remembers it — axiom, inputs, root — whichever
 * list it sits in. The plan's two presentation orders share the planner's
 * state, so a signature names the same fold in both.
 */
export function waySignature(witness: PrecreaseWitness): string {
  return `${witness.axiom}:${witness.inputs.map(refSignature).join(',')}:${witness.root}`;
}

/**
 * Where a card's choice is kept: the sheet (its index in the plan's variants)
 * and the line its fold makes. By line rather than by step, so a choice
 * survives Landmarks first renumbering the steps, and a fold and the presses
 * that show its witness share one.
 */
export function wayKey(component: number, step: PrecreaseStep): string {
  return `${component}:${step.line_id}`;
}

/** The ways a step offers, the pick first; none for a step with one. */
export function stepWays(step: PrecreaseStep | undefined): readonly PrecreaseWay[] {
  return step?.ways && step.ways.length >= 2 ? step.ways : [];
}

function wayIndex(step: PrecreaseStep, signature: string | undefined): number {
  if (signature === undefined) return 0;
  const index = stepWays(step).findIndex((way) => waySignature(way.witness) === signature);
  return Math.max(0, index);
}

/** The way `choices` holds for `step`: the pick, 0, when it holds none that still exists. */
export function chosenWayIndex(
  component: number,
  step: PrecreaseStep,
  choices: ReferencesWayChoices
): number {
  return wayIndex(step, choices[wayKey(component, step)]);
}

/** The way a step, as presented, shows. */
export function shownWayIndex(step: PrecreaseStep): number {
  const shown = chosenWitness(step);
  return shown ? wayIndex(step, waySignature(shown)) : 0;
}

/** How many ways a card offers and which one it shows; null for a card with one. */
export interface ReferencesCardWays {
  count: number;
  index: number;
}

export function cardWays(step: PrecreaseStep | undefined): ReferencesCardWays | null {
  const ways = stepWays(step);
  if (!step || ways.length === 0) return null;
  return { count: ways.length, index: shownWayIndex(step) };
}

/** How many of a plan's cards offer another way to fold them. */
export function cardsWithWays(sequence: PrecreaseSequence): number {
  return new Set(sequence.steps.filter((step) => stepWays(step).length > 0).map((s) => s.card))
    .size;
}

/** `step` presenting `way` in place of its pick. */
function presenting(step: PrecreaseStep, way: PrecreaseWay): PrecreaseStep {
  return {
    ...step,
    witnesses: [...step.witnesses, way.witness],
    chosen: step.witnesses.length,
    ease: way.witness.ease,
    hard: way.witness.hard,
    err: way.witness.err,
    also: way.also,
    alignment: way.alignment,
  };
}

/**
 * `sequence` as the reader chose to fold it: each chosen way swapped into its
 * steps — the fold, the presses that show its witness, and on a twin card the
 * twin, with the way of the same index in its own list. Steps left as planned
 * keep their identity, and so does the sequence when nothing is chosen.
 */
export function presentedSequence(
  sequence: PrecreaseSequence,
  component: number,
  choices: ReferencesWayChoices
): PrecreaseSequence {
  let steps: PrecreaseStep[] | null = null;
  const replace = (index: number, step: PrecreaseStep) => {
    steps ??= sequence.steps.slice();
    steps[index] = step;
  };
  for (let index = 0; index < sequence.steps.length; index += 1) {
    const step = sequence.steps[index];
    const chosen = chosenWayIndex(component, step, choices);
    const twin = cardTwin(sequence, index);
    if (chosen > 0) {
      replace(index, presenting(step, stepWays(step)[chosen]));
      const mirrored = twin === undefined ? undefined : stepWays(sequence.steps[twin])[chosen];
      if (twin !== undefined && mirrored) replace(twin, presenting(sequence.steps[twin], mirrored));
    }
    if (twin !== undefined) index = twin;
  }
  return steps ? { ...sequence, steps } : sequence;
}

/**
 * `choices` with `step`'s card set to way `index` — the pick drops the
 * card's entry, so the choices hold only what differs from the plan.
 */
export function withWayChoice(
  choices: ReferencesWayChoices,
  component: number,
  step: PrecreaseStep,
  index: number
): ReferencesWayChoices {
  const way = stepWays(step)[index];
  if (!way) return choices;
  const key = wayKey(component, step);
  if (index > 0) return { ...choices, [key]: waySignature(way.witness) };
  if (!(key in choices)) return choices;
  return Object.fromEntries(Object.entries(choices).filter(([entry]) => entry !== key));
}

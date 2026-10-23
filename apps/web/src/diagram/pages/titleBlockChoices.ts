/**
 * What the Page pane offers for the first page's title block
 * (`implementation-plans/diagram-title-block.md`, section 7): for the
 * finished model and for the crease pattern, Auto — named by the step it
 * finds now — the steps that can give that part, and None. Nothing else, so
 * every choice is one the block can show.
 *
 * The model's steps are the steps with a picture. The pattern's are one per
 * distinct pattern the steps link — a region of Edit's, or a Fold step's
 * state — told apart as the file's thumbnail table tells them
 * (`thumbnailJson`), each named by the last step that links it, or
 * by the step chosen where that one links it: fifty steps on one sheet are
 * one choice. Whether a step gives a part is the page's own answer
 * (`givesModel`, `givesPattern`), so nothing offered prints nothing. A step
 * chosen that can no longer give its part — its picture removed, its link
 * replaced or drawing no line — is listed too, in its place and marked,
 * since it is what the block is set to. Pure.
 */
import { thumbnailJson } from '../document/diagramFile';
import {
  stepNumbers,
  stepsOf,
  type DiagramDocument,
  type DiagramStep,
  type DiagramTitleBlockSource,
} from '../document/diagramDocument';
import {
  autoModelStep,
  autoPatternStep,
  givesModel,
  givesPattern,
  resolveTitleBlock,
  type TitleBlockPart,
} from './titleBlockContent';

const STEP = 'step:';

/** A part's choice as a select holds it: Auto, None, or a step by its id. */
export type TitleBlockChoice = 'auto' | 'none' | `${typeof STEP}${string}`;

/** A step offered for a part. */
export interface TitleBlockStepChoice {
  choice: TitleBlockChoice;
  /** Its number, as the pages print it. */
  number: number;
  /** Whether it can give the part: false only for the step chosen, once it no longer can. */
  gives: boolean;
}

/** What the Page pane offers for one part of the title block, and what the part is set to. */
export interface TitleBlockPartChoices {
  /** The part's choice now; a step chosen that is gone reads as Auto (`resolveTitleBlock`). */
  value: TitleBlockChoice;
  /** The number of the step Auto finds now; null where it finds none. */
  autoNumber: number | null;
  /** The steps offered between Auto and None, in the diagram's order. */
  steps: readonly TitleBlockStepChoice[];
}

export interface TitleBlockChoices {
  model: TitleBlockPartChoices;
  pattern: TitleBlockPartChoices;
}

/** What the Page pane offers for the title block's model and pattern. */
export function titleBlockChoices(document: DiagramDocument): TitleBlockChoices {
  const resolved = resolveTitleBlock(document);
  const numbers = stepNumbers(document);
  const steps = stepsOf(document);
  const numberOf = (step: DiagramStep | null) => (step ? numbers.get(step.id)! : null);
  /** A part's choices: the steps `offered`, and the step chosen for it whether or not it can give it. */
  const part = (
    chosen: TitleBlockPart,
    auto: DiagramStep | null,
    offered: ReadonlySet<DiagramStep>,
    gives: (step: DiagramStep) => boolean
  ): TitleBlockPartChoices => ({
    value: choiceOf(chosen),
    autoNumber: numberOf(auto),
    steps: steps
      .filter((step) => offered.has(step) || (chosen.from === 'step' && chosen.step === step))
      .map((step) => ({ choice: stepChoice(step), number: numberOf(step)!, gives: gives(step) })),
  });
  return {
    model: part(resolved.model, autoModelStep(document), new Set(steps.filter(givesModel)), givesModel),
    pattern: part(resolved.pattern, autoPatternStep(document), distinctPatterns(steps, resolved.pattern), givesPattern),
  };
}

/**
 * One step for each distinct pattern the steps link: the step chosen for the
 * block where it links that pattern, else the last that does. A region of
 * Edit's and a Fold step's state are never one pattern: their aux lines are
 * read apart (`patternScene`).
 */
function distinctPatterns(steps: readonly DiagramStep[], chosen: TitleBlockPart): ReadonlySet<DiagramStep> {
  const named = new Map<string, DiagramStep>();
  for (const step of steps) {
    if (!givesPattern(step)) continue;
    const pattern = `${step.source.kind} ${thumbnailJson(step.source.thumbnail)}`;
    if (chosen.from !== 'step' || named.get(pattern) !== chosen.step) named.set(pattern, step);
  }
  return new Set(named.values());
}

/** What a choice sets its part to: a source, or `auto`, which takes the part's source away. */
export function titleBlockChoiceSource(choice: string): DiagramTitleBlockSource | 'auto' {
  if (choice === 'none') return { kind: 'none' };
  return choice.startsWith(STEP) ? { kind: 'step', stepId: choice.slice(STEP.length) } : 'auto';
}

function choiceOf(part: TitleBlockPart): TitleBlockChoice {
  return part.from === 'step' && part.step ? stepChoice(part.step) : part.from === 'none' ? 'none' : 'auto';
}

function stepChoice(step: DiagramStep): TitleBlockChoice {
  return `${STEP}${step.id}`;
}

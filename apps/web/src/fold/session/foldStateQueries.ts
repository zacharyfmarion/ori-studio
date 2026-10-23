/**
 * The pure queries every Fold surface asks of a landed state, one function
 * each, so the session asks the engine once per state however many surfaces
 * want the answer (`FoldSession.query`): the canvas reads the scene, the
 * strip builds its frames from it, and the Step pane
 * and the tool's preview read the same step summary — a committed preview's
 * answers are the committed step's.
 */
import { canonicalJson } from '../document/foldDigest';
import type { FoldChoices, FoldModelLine, SheetPoint } from '../document/foldSequenceDocument';
import { foldStepSummaryAnswer } from '../engine/foldEnginePreview';
import {
  type FoldActed,
  type FoldEngineOp,
  type FoldEngineOutcome,
  type FoldLandmarks,
  type FoldScene,
  type FoldSectioned,
  type FoldSide,
  type FoldStepSummarised,
} from '../engine/foldEngineWire';
import type { FoldStateCall } from './foldSession';
import { foldStepInputKey } from './foldSessionEngine';

/** The state's scene. */
export const FOLD_SCENE_QUERY: FoldStateCall<FoldScene> = (engine, state) => engine.scene(state);

/** The pinch length a partial precrease's tool offers on the state's sheet (`defaultPinchLength`). */
export const FOLD_PINCH_LENGTH_QUERY: FoldStateCall<number> = (engine, state) => engine.defaultPinchLength(state);

/**
 * The engine's summary of the step that landed a state: its counts, its diff
 * and its layers (plan D14). None when refused, or when the state's parent is
 * no longer held: a surface shows what it knows without it.
 */
export const FOLD_STEP_SUMMARY_QUERY: FoldStateCall<FoldStepSummarised> = async (engine, state) => {
  const read = await engine.stepSummary(state).then(
    (outcome) => () => outcome,
    (error: unknown) => () => {
      throw error;
    }
  );
  return foldStepSummaryAnswer(read);
};

/**
 * How many queries with arguments are kept of each kind: a pointer that snaps
 * keeps landing on the same few lines. A query let go takes its answers with
 * it (`foldSessionAnswers.ts` keeps them by the query).
 */
const ARGUMENT_QUERIES_KEPT = 64;

/**
 * Queries that take arguments, one function per set of them: the same
 * function for the same key, so every asker shares one answer per state, and
 * an answer the engine gave with another call is found under it.
 */
function argumentQueries<T>(): (key: string, make: () => FoldStateCall<T>) => FoldStateCall<T> {
  const queries = new Map<string, FoldStateCall<T>>();
  return (key, make) => {
    const known = queries.get(key);
    if (known) {
      queries.delete(key);
      queries.set(key, known);
      return known;
    }
    const query = make();
    queries.set(key, query);
    for (const oldest of queries.keys()) {
      if (queries.size <= ARGUMENT_QUERIES_KEPT) break;
      queries.delete(oldest);
    }
    return query;
  };
}

const actionQueries = argumentQueries<FoldEngineOutcome<FoldActed>>();

/**
 * A fold's picture on the state it folds from (`action`): the tool's preview
 * asks it, and a preview's turn in the worker answers it with the orders
 * (`foldEnginePreview.ts`).
 */
export function foldActionQuery(op: FoldEngineOp, choices?: FoldChoices): FoldStateCall<FoldEngineOutcome<FoldActed>> {
  return actionQueries(foldStepInputKey({ op, choices }), () => (engine, state) => engine.action(state, op, choices));
}

const landmarkQueries = argumentQueries<FoldLandmarks>();

/**
 * A state's landmarks, with the Divide-line marks at `marks` (sheet points)
 * as point landmarks: what the canvas picks among (`useFoldStateView`). A
 * landed preview's are asked ahead with the marks on screen — the step it
 * becomes shows the same marks — so a commit finds them in.
 */
export function foldLandmarksQuery(marks: readonly SheetPoint[]): FoldStateCall<FoldLandmarks> {
  return landmarkQueries(canonicalJson(marks), () => (engine, state) => engine.landmarks(state, marks));
}

const sectionQueries = argumentQueries<FoldEngineOutcome<FoldSectioned>>();

/**
 * The layers along a model line on one side of it (`crossSection`): the line
 * a fold is located on asks it, and an axiom's roots answer it for each root
 * (`foldEngineRoots.ts`).
 */
export function foldCrossSectionQuery(line: FoldModelLine, side: FoldSide): FoldStateCall<FoldEngineOutcome<FoldSectioned>> {
  return sectionQueries(`${canonicalJson(line)}|${side}`, () => (engine, state) => engine.crossSection(state, line, side));
}

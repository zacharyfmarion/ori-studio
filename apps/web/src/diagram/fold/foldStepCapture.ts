/**
 * A Diagram step's picture, captured from a step of a Fold sequence (plan
 * D17): the Fold session is held while it works — so it runs from the
 * Diagram with no Fold surface open — the step and the state it folds from
 * are waited for as the session replays them, the engine is asked what they
 * are, and the picture, its marks and its source are made from the answers
 * (`foldStepPicture`).
 *
 * Never folds anything itself: what a step lands is the session's replay of
 * the sequence, cached by its path, so a capture asks the engine only about
 * states it has landed — but for the steps inside a Repeat a merged run of
 * precreases draws (`foldRunCapture.ts`). The session is injected, so this
 * is tested over a fake one; the app binds it in `foldStepActions.ts`.
 *
 * React-free and store-free.
 */

import type { TFunction } from 'i18next';
import { isLockedStep, type FoldStepNode } from '../../fold/document/foldSequenceDocument';
import type { FoldScene } from '../../fold/engine/foldEngineWire';
import { foldStepReady, type FoldStepReady, type FoldStepWaitRefusal } from '../../fold/io/foldSessionWaits';
import { foldNodeSentenceStep } from '../../fold/sequence/foldSentenceStep';
import { foldStateFrame } from '../../fold/sequence/foldStateFrame';
import type { FoldSession } from '../../fold/session/foldSession';
import type { FoldSentenceStep } from '../../fold/stepSentence';
import { xmlText } from '../../lib/xmlEscape';
import type { CapturedPicture } from '../capture/captureFolded';
import {
  randomDiagramId,
  type DiagramCpRender,
  type DiagramFoldMoment,
  type DiagramFoldStepSource,
  type DiagramIdFactory,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { storedFoldStepSource } from '../document/diagramFile';
import { foldDiagramSentence } from './foldDiagramSentence';
import { foldStepAction } from './foldStepMarkPlan';
import { foldStepPicture, type FoldStepPictureInput } from './foldStepPicture';
import { foldRepeatCallout } from './foldRepeatCallout';
import { readFoldRunCapture } from './foldRunCapture';

/** Which Fold step a picture is captured from, at which moment, in which pose. */
export interface FoldStepCaptureRequest {
  sequence: string;
  step: string;
  /** The last of a run of steps drawn as one, from `step`, before it folds (`foldPrecreaseMerge.ts`). */
  through?: string;
  moment: DiagramFoldMoment;
  /** A crease pattern, or a flat fold at `foldCase` 1. */
  render: DiagramCpRender;
}

export type FoldStepCaptureResult =
  | {
      status: 'captured';
      /** The step's source as captured: its digests, thumbnail, render and sentence. */
      source: DiagramFoldStepSource;
      captured: CapturedPicture;
      /** The fold's line and arrow, tagged as the source's; empty when it brings none. */
      marks: KnownDiagramAnnotation[];
    }
  /** The step is gone from the sequence, or no longer folds. */
  | { status: 'missing' }
  /**
   * Fold cannot say: the sequence is not the one it shows (one is shown, plan
   * D7), a newer build made the step, or the engine could not be reached.
   */
  | { status: 'unknown'; why: 'not-shown' | 'locked' | 'unavailable' };

/**
 * The step's instruction, as the Diagram words it (`foldDiagramSentence`):
 * the fold's kind, read from the states either side of it and what the fold
 * did. Absent for the state after the step, whose words are the author's
 * (the Finished step a pull ends with).
 */
function sentenceOf(t: TFunction, moment: DiagramFoldMoment, words: FoldSentenceStep): string | undefined {
  return moment === 'before' ? xmlText(foldDiagramSentence(t, words)) : undefined;
}

/**
 * What a Fold step's picture is made from, as the session's replay has it:
 * the states either side of the step, what the step does, and the step
 * itself — everything `foldStepPicture` draws from, so a pose drawn again
 * from it needs no engine (a spread's slider, dragged). Asked of the session
 * the caller holds.
 */
export interface FoldStepCaptureInput {
  picture: FoldStepPictureInput;
  /** The step's replay — a run's first's. */
  ready: FoldStepReady;
  /** The state the step folds from. */
  parent: FoldScene;
  node: FoldStepNode;
  engineVersion: number;
  /**
   * A run of steps drawn as one (`foldRunCapture.ts`): its last step's
   * replay, whose path names every step of the run, and the merged step's
   * sentence. Absent for one step.
   */
  run?: { last: FoldStepReady; sentence: string };
}

/** Why a capture cannot be made from a step, as one that is not ready says. */
export type FoldStepCaptureRefusal = Exclude<FoldStepCaptureResult, { status: 'captured' }>;

/** What a capture says of a step the session cannot give it (`foldStepReady`'s refusal). */
export function captureRefusal(reason: FoldStepWaitRefusal['reason']): FoldStepCaptureRefusal {
  switch (reason) {
    case 'missing':
    case 'broken':
      return { status: 'missing' };
    case 'not-shown':
      return { status: 'unknown', why: 'not-shown' };
    case 'locked':
      return { status: 'unknown', why: 'locked' };
    case 'not-live':
      return { status: 'unknown', why: 'unavailable' };
  }
}

/** Read what a Fold step's picture is made from — or a run's, drawn as one — or why it cannot be. */
export async function readFoldStepCapture(
  session: FoldSession,
  request: Pick<FoldStepCaptureRequest, 'sequence' | 'step' | 'through' | 'moment'>,
  t: TFunction,
): Promise<{ status: 'ready'; input: FoldStepCaptureInput } | FoldStepCaptureRefusal> {
  const ready = await foldStepReady(session, request.sequence, request.step);
  if (ready.status !== 'ready') return captureRefusal(ready.reason);
  if (request.through !== undefined) {
    return readFoldRunCapture(session, { ...request, through: request.through }, ready, t);
  }
  const own = await session.withState(ready.state, async (engine, id) => {
    const [scene, summary, acted, engineVersion] = await Promise.all([
      engine.scene(id),
      engine.summary(id),
      engine.stepAction(id),
      engine.engineVersion(),
    ]);
    return { scene, summary, action: acted.status === 'ok' ? acted.action : null, engineVersion };
  });
  const parent = await session.withState(ready.parentState, async (engine, id) => {
    const [scene, summary] = await Promise.all([engine.scene(id), engine.summary(id)]);
    return { scene, step: summary.step };
  });
  if (own.status !== 'answered' || parent.status !== 'answered') return { status: 'unknown', why: 'unavailable' };
  const { scene, summary, action, engineVersion } = own.value;
  const node = session.store.getState().sequence?.steps.find((step) => step.id === request.step);
  if (!node) return { status: 'missing' };
  const op = isLockedStep(node) ? null : node.op;
  let repeat: FoldStepPictureInput['repeat'];
  if (request.moment === 'before' && op?.kind === 'repeat') {
    repeat = foldRepeatCallout(parent.value.scene, scene, parent.value.step, op.axis, t);
  }
  return {
    status: 'ready',
    input: {
      picture: {
        shown: request.moment === 'after' ? scene : parent.value.scene,
        // Every crease made since the state it folds from is the step's: a Repeat's every operation's.
        own: { scene, step: summary.step, sheet: summary.sheet, since: parent.value.step },
        moment: request.moment,
        action:
          request.moment === 'before' && action ? foldStepAction(action, { op, parent: parent.value.scene, child: scene }) : null,
        ...(repeat ? { repeat } : {}),
      },
      ready,
      parent: parent.value.scene,
      node,
      engineVersion,
    },
  };
}

/** Capture a Diagram step's picture from a Fold step, start to finish. */
export async function captureFoldStep(
  session: FoldSession,
  request: FoldStepCaptureRequest,
  { t, newId = randomDiagramId }: { t: TFunction; newId?: DiagramIdFactory }
): Promise<FoldStepCaptureResult> {
  const release = session.retain();
  try {
    const read = await readFoldStepCapture(session, request, t);
    if (read.status !== 'ready') return read;
    const { picture: input, ready, parent, node, engineVersion, run } = read.input;
    const picture = foldStepPicture(input, request.render, newId);
    const sentence = run
      ? xmlText(run.sentence)
      : sentenceOf(
          t,
          request.moment,
          foldNodeSentenceStep(node, {
            parent: foldStateFrame(parent),
            child: foldStateFrame(input.own.scene),
            report: ready.folded,
          })
        );
    const source = storedFoldStepSource({
      kind: 'fold-step',
      sequence: request.sequence,
      step: request.step,
      ...(run && request.through !== undefined ? { through: request.through } : {}),
      moment: request.moment,
      // A run's last step's path, which names every step of it.
      path: (run?.last ?? ready).path,
      state: request.moment === 'after' ? ready.fingerprint : ready.parentFingerprint,
      engine: engineVersion,
      thumbnail: picture.thumbnail,
      render: request.render,
      ...(sentence !== undefined ? { sentence } : {}),
    });
    if (!source) throw new Error('The capture made a link the file cannot read');
    return { status: 'captured', source, captured: picture.captured, marks: picture.marks };
  } finally {
    release();
  }
}

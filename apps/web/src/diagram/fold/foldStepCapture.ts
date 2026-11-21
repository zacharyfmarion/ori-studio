import { connectedFlatPicture, spreadFailedPicture } from '../capture/captureFolded';
import { prepareConnected } from '../../layer-spread/prepareConnected';
import { foldScenePattern } from './foldStepPicture';
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
import { foldStepReady, type FoldStepReady, type FoldStepWaitRefusal } from '../../fold/io/foldSessionWaits';
import { foldNodeSentenceStep } from '../../fold/sequence/foldSentenceStep';
import { foldStateFrame } from '../../fold/sequence/foldStateFrame';
import type { FoldSession } from '../../fold/session/foldSession';
import { xmlText } from '../../lib/xmlEscape';
import type { CapturedPicture } from '../capture/captureFolded';
import {
  randomDiagramId,
  spreadFailedRender,
  type DiagramCpRender,
  type DiagramFoldMoment,
  type DiagramFoldStepSource,
  type DiagramIdFactory,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { storedFoldStepSource } from '../document/diagramFile';
import { diagramCreaseWords, foldDiagramSentence } from './foldDiagramSentence';
import { diagramFoldConstruction } from './foldCreaseConstruction';
import { foldStepMarkAction } from './foldStepMarkPlan';
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
  /** Generated words for the before picture. The Finished step has no instruction. */
  sentence?: string;
  engineVersion: number;
  /**
   * A run of steps drawn as one (`foldRunCapture.ts`): its last step's
   * replay, whose path names every step of the run. Absent for one step.
   */
  last?: FoldStepReady;
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
  const steps = session.store.getState().sequence?.steps;
  const stored = steps?.find((step) => step.id === request.step);
  if (!steps || !stored) return { status: 'missing' };
  let node = stored;
  let sentence: string | undefined;
  if (request.moment === 'before') {
    const parentFrame = foldStateFrame(parent.value.scene);
    const childFrame = foldStateFrame(scene);
    node = diagramFoldConstruction(steps, stored, parentFrame, childFrame);
    const words = foldNodeSentenceStep(node, { parent: parentFrame, child: childFrame, report: ready.folded, pockets: ready.pockets });
    sentence = foldDiagramSentence(t, diagramCreaseWords(words, parentFrame, childFrame));
  }
  const op = node.op ?? null;
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
        // A collapse's marks are the creases it folds: the engine draws none of an import.
        action: request.moment === 'before' ? foldStepMarkAction(action, { op, parent: parent.value.scene, child: scene }) : null,
        ...(repeat ? { repeat } : {}),
      },
      ready,
      sentence,
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
    const { picture: input, ready, sentence, engineVersion, last } = read.input;
    const asked = request.render;
    let render = asked;
    let picture: ReturnType<typeof foldStepPicture>;
    if (asked.mode === 'folded-flat' && asked.spread?.kind === 'connected') {
      const scene = foldScenePattern(input.shown, asked.side);
      const lease = prepareConnected(scene);
      try {
        const spread = await connectedFlatPicture(scene, asked.rotationDeg, asked.spread, lease.promise, asked.presentation);
        if (spread.kind === 'spread') picture = foldStepPicture(input, asked, newId, spread.connected, spread.captured);
        else {
          // Layers that could not be spread are drawn unspread, the spread kept to say so (`spreadFailedPicture`).
          const { spread: _spread, presentation: _presentation, ...unspread } = asked;
          const drawn = foldStepPicture(input, unspread, newId);
          picture = { ...drawn, captured: spreadFailedPicture(drawn.captured) };
          render = spreadFailedRender(asked);
        }
      } finally {
        lease.release();
      }
    } else {
      picture = foldStepPicture(input, asked, newId);
    }
    const source = storedFoldStepSource({
      kind: 'fold-step',
      sequence: request.sequence,
      step: request.step,
      ...(last && request.through !== undefined ? { through: request.through } : {}),
      moment: request.moment,
      // A run's last step's path, which names every step of it.
      path: (last ?? ready).path,
      state: request.moment === 'after' ? ready.fingerprint : ready.parentFingerprint,
      engine: engineVersion,
      thumbnail: picture.thumbnail,
      render,
      ...(sentence !== undefined ? { sentence: xmlText(sentence) } : {}),
    });
    if (!source) throw new Error('The capture made a link the file cannot read');
    return { status: 'captured', source, captured: picture.captured, marks: picture.marks };
  } finally {
    release();
  }
}

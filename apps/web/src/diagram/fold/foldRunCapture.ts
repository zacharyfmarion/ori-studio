/**
 * What a run of Fold steps drawn as one Diagram step is captured from: a run
 * of precreases and a Repeat of them (`foldPrecreaseMerge.ts`), or steps each
 * the mirror image or turned copy of one before it, every one folding paper
 * no other touches (`foldStepMerge.ts`). The step shows the state before the
 * first with every step's line and arrow on it (`merged`), its crease
 * pattern the last state's with every crease the run made as the instruction
 * (`since`), and the merged step's sentence.
 *
 * As one step's capture (`foldStepCapture.ts`) it waits for the session's
 * replay to land each step, and asks the engine only about those states —
 * but for a Repeat's own steps after its first, each drawn on the state the
 * one before it lands, which it lands on the way and lets go.
 *
 * Each step's picture is in the frame of the state it folds from, carried
 * into the first's. That is the same paper in the same place: a precrease
 * moves none, and a step of a merged run folds paper none before it moved.
 *
 * React-free and store-free: the session is injected.
 */

import type { TFunction } from 'i18next';
import { applyIsometry, invertIsometry } from '../../fold/canvas/foldCanvasGeometry';
import { foldStepTree, pathBetween } from '../../fold/document/foldStepTree';
import { isLockedStep, type FoldStepNode } from '../../fold/document/foldSequenceDocument';
import type { FoldIsometry, FoldScene } from '../../fold/engine/foldEngineWire';
import { foldStepReady, type FoldStepReady } from '../../fold/io/foldSessionWaits';
import { compose } from '../../fold/repeat/repeatGeometry';
import { foldNodeSentenceStep } from '../../fold/sequence/foldSentenceStep';
import { foldStateFrame } from '../../fold/sequence/foldStateFrame';
import type { FoldSession } from '../../fold/session/foldSession';
import { FOLD_SCENE_QUERY } from '../../fold/session/foldStateQueries';
import type { Point } from '../../lib/geometry';
import { foldDiagramMergedSentence } from './foldDiagramSentence';
import { isRepeatRun } from './foldPrecreaseMerge';
import { foldStepAction, type FoldStepAction } from './foldStepMarkPlan';
import { isMergeableStep, runMergeRelation, type FoldMergeStep } from './foldStepMerge';
import { sharedFoldMergeCache } from './foldStepMergeSession';
import { captureRefusal, type FoldStepCaptureInput, type FoldStepCaptureRefusal } from './foldStepCapture';

const UNAVAILABLE: FoldStepCaptureRefusal = { status: 'unknown', why: 'unavailable' };

/** A step's picture, its marks placed (`foldStepMarkPlan.ts`), and the view of the state it is drawn on. */
interface SeenAction {
  action: FoldStepAction;
  view: FoldIsometry;
}

/** `action`, drawn in the frame of a state with view `from`, as the frame of one with view `to` draws it. */
function actionSeenIn(action: FoldStepAction, from: FoldIsometry, to: FoldIsometry): FoldStepAction {
  const map = compose(to, invertIsometry(from));
  const at = (point: Point): Point => applyIsometry(map, point);
  return {
    ...action,
    line: action.line ? [at(action.line[0]), at(action.line[1])] : null,
    spans: action.spans.map((span) => ({ ...span, from: at(span.from), to: at(span.to) })),
    grip: action.grip ? { ...action.grip, at: at(action.grip.at), image: at(action.grip.image) } : null,
    ...(action.push ? { push: { at: at(action.push.at), toward: at(action.push.toward) } } : {}),
    ...(action.pleat ? { pleat: { ...action.pleat, from: at(action.pleat.from), to: at(action.pleat.to) } } : {}),
    ...(action.rings ? { rings: action.rings.map((ring) => ({ ...ring, at: at(ring.at) })) } : {}),
    ...(action.uncreased ? { uncreased: action.uncreased.map((stretch) => ({ from: at(stretch.from), to: at(stretch.to) })) } : {}),
  };
}

/**
 * What one step of a run does, on the state it folds from (`before`): a
 * step's own picture; a Repeat's steps' each, the first on the state before
 * it, every later one on the state the one before it lands — landed here,
 * and let go. Null when the engine could not say.
 */
async function stepActions(
  session: FoldSession,
  node: FoldStepNode,
  ready: FoldStepReady,
  before: FoldScene
): Promise<SeenAction[] | null> {
  if (isLockedStep(node)) return [];
  if (node.op.kind !== 'repeat') {
    const acted = await session.withState(ready.state, (engine, id) => engine.stepAction(id));
    if (acted.status !== 'answered') return null;
    const action = acted.value.status === 'ok' ? acted.value.action : null;
    return action ? [{ action: foldStepAction(action, { op: node.op, parent: before }), view: before.view_transform }] : [];
  }
  const entries = node.op.steps;
  const asked = await session.withState(ready.parentState, async (engine, id) => {
    const seen: SeenAction[] = [];
    const landed: number[] = [];
    let current = id;
    let scene = before;
    try {
      for (const [index, entry] of entries.entries()) {
        const acted = await engine.action(current, entry.op, entry.choices);
        if (acted.status !== 'ok') return null;
        seen.push({ action: foldStepAction(acted.action, { op: entry.op, parent: scene }), view: scene.view_transform });
        if (index === entries.length - 1) break;
        const next = await engine.apply(current, entry.op, entry.choices);
        if (next.status !== 'ok') return null;
        landed.push(next.state);
        current = next.state;
        scene = await engine.scene(current);
      }
      return seen;
    } finally {
      if (landed.length > 0) await engine.release(landed);
    }
  });
  return asked.status === 'answered' ? asked.value : null;
}

/**
 * Read what a run of steps — `step` through `through` on one path, the first
 * already landed (`first`) — is drawn from as one step, or why it cannot be:
 * gone, no longer one path, or no longer drawn as one — not precreases and
 * their Repeat, nor steps that repeat each other on paper of their own
 * (`missing`); a step of it the session cannot give.
 */
export async function readFoldRunCapture(
  session: FoldSession,
  request: { sequence: string; step: string; through: string; moment: 'before' | 'after' },
  first: FoldStepReady,
  t: TFunction
): Promise<{ status: 'ready'; input: FoldStepCaptureInput } | FoldStepCaptureRefusal> {
  const document = session.store.getState().sequence;
  const run = document?.id === request.sequence ? pathBetween(foldStepTree(document.steps), request.step, request.through) : null;
  // A run is drawn as one before its first step folds: precreases and their Repeat, or steps the scenes say repeat each other.
  if (!run || request.moment !== 'before' || run.length < 2) return { status: 'missing' };
  const repeat = isRepeatRun(run);
  if (!repeat && !run.every(isMergeableStep)) return { status: 'missing' };
  const readies: FoldStepReady[] = [first];
  for (const node of run.slice(1)) {
    const ready = await foldStepReady(session, request.sequence, node.id);
    if (ready.status !== 'ready') return captureRefusal(ready.reason);
    readies.push(ready);
  }
  const last = readies.at(-1)!;
  // Every state of the run: the one before its first step, then the one after each.
  const asked = await Promise.all(
    [first.parentState, ...readies.map((ready) => ready.state)].map((state) => session.query(state, FOLD_SCENE_QUERY))
  );
  const facts = await session.withState(last.state, async (engine, id) => {
    const [summary, engineVersion] = await Promise.all([engine.summary(id), engine.engineVersion()]);
    return { summary, engineVersion };
  });
  const since = await session.withState(first.parentState, (engine, id) => engine.summary(id));
  if (asked.some((scene) => scene.status !== 'answered') || facts.status !== 'answered' || since.status !== 'answered') {
    return UNAVAILABLE;
  }
  const scenes = asked.map((scene) => (scene as Extract<typeof scene, { status: 'answered' }>).value);
  if (!repeat) {
    const steps: FoldMergeStep[] = run.map((node, index) => ({
      id: node.id,
      mergeable: true,
      before: scenes[index]!,
      after: scenes[index + 1]!,
      key: `${readies[index]!.parentFingerprint}|${readies[index]!.fingerprint}`,
    }));
    if (runMergeRelation(steps, sharedFoldMergeCache()) === null) return { status: 'missing' };
  }
  const shown = scenes[0]!;
  const actions: FoldStepAction[] = [];
  for (const [index, node] of run.entries()) {
    const seen = await stepActions(session, node, readies[index]!, scenes[index]!);
    if (seen === null) return UNAVAILABLE;
    actions.push(...seen.map(({ action, view }) => actionSeenIn(action, view, shown.view_transform)));
  }
  // Its words: a Repeat run's steps but the Repeat, said once for both sides; a merged run's first step, said for every place.
  const words = (repeat ? run.slice(0, -1) : run.slice(0, 1)).map((node, index) =>
    foldNodeSentenceStep(node, {
      parent: foldStateFrame(scenes[index]!),
      child: foldStateFrame(scenes[index + 1]!),
      report: readies[index]!.folded,
      pockets: readies[index]!.pockets,
    })
  );
  const { summary, engineVersion } = facts.value;
  return {
    status: 'ready',
    input: {
      picture: {
        shown,
        own: { scene: scenes.at(-1)!, step: summary.step, sheet: summary.sheet, since: since.value.step },
        moment: 'before',
        action: actions[0] ?? null,
        merged: actions.slice(1),
      },
      ready: first,
      parent: shown,
      node: run[0]!,
      engineVersion,
      run: { last, sentence: foldDiagramMergedSentence(t, words, repeat ? 2 : run.length) },
    },
  };
}

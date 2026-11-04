/**
 * Steps pulled from a Fold sequence into the Diagram (plan D17), as the
 * References browser pulls a plan's cards (D20): the shown sequence's active
 * path as cards, and what each adds.
 *
 * - **A fold** becomes a step showing the state before it, folded, its line
 *   and arrow as the step's marks, its kind as the step's words
 *   (`foldDiagramSentence`) — as a References card shows its step.
 * - **A turn or a rotation** becomes a turn between steps (D22), as a
 *   References turn-over card does.
 * - **Finished**, after the last fold, is the state the path ends at, with no
 *   words of Fold's: as References' Finished card ends a plan.
 *
 * Every picture is captured from the Fold session's replay
 * (`captureFoldStep`), a card's as the step it adds is
 * (`foldPullPreviews.ts`); nothing is folded here.
 *
 * React-free and store-free: the session is injected.
 */

import type { TFunction } from 'i18next';
import { isLockedStep, turnKindOf, type FoldSequenceDocument } from '../../fold/document/foldSequenceDocument';
import { foldStateSpread } from '../../fold/document/foldStepSpread';
import { foldCardHandleKey } from '../../fold/sequence/foldCardPictureSource';
import type { FoldSequenceView } from '../../fold/sequence/useFoldSequenceView';
import type { FoldSession } from '../../fold/session/foldSession';
import type { TurnKind } from '../../lib/steps/turn';
import { turnName } from '../../lib/steps/turnWords';
import { reportError } from '../../monitoring';
import {
  DEFAULT_LAYER_SPREAD,
  randomDiagramId,
  type DiagramCpRender,
  type DiagramFoldMoment,
  type DiagramIdFactory,
  type SentDiagramEntry,
  type SentFoldStep,
} from '../document/diagramDocument';
import type { PullCard } from '../references/referencesBrowserSelection';
import { foldDiagramMergedSentence, foldDiagramSentence } from './foldDiagramSentence';
import type { FoldPrecreaseMerge } from './foldPrecreaseMerge';
import { captureFoldStep, type FoldStepCaptureResult } from './foldStepCapture';

/**
 * What pulling a Fold card adds: a step at a moment — or a run of steps drawn
 * as one, from `step` through `through`, before the first folds
 * (`foldPrecreaseMerge.ts`) — or a turn between steps.
 */
export type FoldPullTarget =
  | { readonly kind: 'step'; readonly step: string; readonly through?: string; readonly moment: DiagramFoldMoment }
  | { readonly kind: 'turn'; readonly turn: TurnKind };

/** A step target: a step at a moment, or a run of steps drawn as one. */
export type FoldPullStepTarget = Extract<FoldPullTarget, { kind: 'step' }>;

/**
 * What a Fold browser card's picture is captured from (`foldPullPreviews.ts`):
 * the step the card adds — a turn's card, the state after the turn — in the
 * render a pull gives it ({@link foldPullRender}).
 */
export interface FoldPullPreviewRequest {
  readonly sequence: string;
  readonly target: FoldPullStepTarget;
  readonly render: Extract<DiagramCpRender, { mode: 'folded-flat' }>;
  /**
   * What names the picture whatever the engine's handles: the sequence, the
   * target, the path to the state it is drawn from (`fh1`, which names every
   * fold before it: a run's last step's names the run) and the render.
   */
  readonly key: string;
}

/**
 * A Fold browser card's picture: once its state has landed, the step it
 * adds, captured as the pull captures it — with its fold's line and arrow,
 * spread as the step will be; `pending` while the replay has still to land
 * it; `none` when nothing will — the step broke, is a newer build's, or the
 * replay stopped short.
 */
export type FoldBrowserPicture =
  | { readonly status: 'landed'; readonly preview: FoldPullPreviewRequest }
  | { readonly status: 'pending' }
  | { readonly status: 'none' };

/** A card of the Fold browser: a step of the active path, a run of them merged, a turn, or Finished. */
export interface FoldBrowserCard extends PullCard<FoldPullTarget> {
  /** The step's number on the path, as Fold numbers it — a merged run's first; null for a turn or Finished. */
  readonly number: number | null;
  /** A merged run's last step's number; absent for one step. */
  readonly through?: number;
  /** The step's words, or the turn's. */
  readonly sentence: string;
  readonly picture: FoldBrowserPicture;
}

const PICTURE_PENDING: FoldBrowserPicture = Object.freeze({ status: 'pending' });
const PICTURE_NONE: FoldBrowserPicture = Object.freeze({ status: 'none' });

/**
 * A card's picture: the step `target` adds, once `entry` — the step whose
 * landing it waits for, a run's last — has landed; else whether it is still
 * to come.
 */
function entryPicture(
  document: FoldSequenceDocument,
  entry: FoldSequenceView['entries'][number],
  target: FoldPullStepTarget,
  replayFailed: boolean
): FoldBrowserPicture {
  const { state, path, fingerprint } = entry.session;
  if (!state) return entry.status === 'pending' && !replayFailed ? PICTURE_PENDING : PICTURE_NONE;
  const render = foldPullRender(document, document.id, target);
  const named = path ?? fingerprint ?? foldCardHandleKey(state);
  const key = [document.id, target.step, target.through ?? '', target.moment, named, JSON.stringify(render)].join('|');
  return { status: 'landed', preview: { sequence: document.id, target, render, key } };
}

/** How a pulled Fold step is shown: folded, as Fold shows it, from the front at no turn. */
export const FOLD_PULL_RENDER: Extract<DiagramCpRender, { mode: 'folded-flat' }> = {
  mode: 'folded-flat',
  side: 'front',
  rotationDeg: 0,
  foldCase: 1,
};

/**
 * How a pulled Fold step is shown: its layers spread as Fold spreads the
 * state it shows (`foldStateSpread`) — the state before the step is its
 * parent's picture, the state after it the step's own — else at the
 * Diagram's default spread (`DEFAULT_LAYER_SPREAD`): a state Fold shows
 * unspread, its spread turned off included, is spread all the same (owner,
 * 2026-11-03), and so is one of a sequence that is not the one given.
 */
export function foldPullRender(
  document: FoldSequenceDocument | null,
  sequence: string,
  target: Pick<FoldPullStepTarget, 'step' | 'moment'>
): Extract<DiagramCpRender, { mode: 'folded-flat' }> {
  const spread = document?.id === sequence ? foldStateSpread(document, target.step, target.moment) : null;
  return { ...FOLD_PULL_RENDER, spread: spread ?? DEFAULT_LAYER_SPREAD };
}

/** Whether a path entry's state has landed, so a capture can be drawn from it. */
function landed(entry: FoldSequenceView['entries'][number]): boolean {
  return entry.session.state !== null && (entry.status === 'ok' || entry.status === 'changed');
}

/**
 * The cards of the sequence's active path, in order: every step after the
 * sheet, a turn or rotation as a turn card, and Finished after the last when
 * the path folds at all. A step that has not landed — still replaying,
 * broken, a newer build's — is listed, and cannot be added; its picture says
 * which (`FoldBrowserPicture`). `failed` is the replay's having stopped short:
 * a step still pending then will not land.
 *
 * Each card's picture is the step it adds; a turn's, the state the turn
 * leaves, which it adds no step for.
 *
 * Each of `merges` — precreases and their mirror images, merged
 * (`foldPrecreaseMerge.ts`) — is one card, the step it becomes: numbered
 * from its first step to its last, every crease of it on the picture, its
 * sentence the merged step's, pictured and added once every step of it has
 * landed.
 */
export function foldBrowserCards(
  t: TFunction,
  { document, entries, words, failed }: Pick<FoldSequenceView, 'document' | 'entries' | 'words' | 'failed'>,
  merges: readonly FoldPrecreaseMerge[] = []
): FoldBrowserCard[] {
  const cards: FoldBrowserCard[] = [];
  const mergeAt = new Map(merges.map((merge) => [merge.steps[0], merge]));
  // The words each card's step will take: the Diagram's (`foldDiagramSentence`), not the strip's lettered ones.
  const wordsAt = (index: number) => words[index] ?? { op: 'unknown' as const };
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const node = entry.node;
    if (!node || entry.id === null) continue;
    const merge = mergeAt.get(entry.id);
    const run = merge ? entries.slice(index, index + merge.steps.length) : [];
    if (merge && run.length === merge.steps.length && run.every((step, k) => step.id === merge.steps[k])) {
      const last = run.at(-1)!;
      const target: FoldPullStepTarget = { kind: 'step', step: entry.id, through: last.id!, moment: 'before' };
      cards.push({
        index: cards.length,
        kind: 'fold',
        number: entry.number,
        ...(last.number !== null ? { through: last.number } : {}),
        // The steps it is made from, the mirror left out: its words are said once, for both sides.
        sentence: foldDiagramMergedSentence(t, run.slice(0, -1).map((_, k) => wordsAt(index + k))),
        picture: entryPicture(document, last, target, failed),
        step: run.every(landed) ? target : null,
      });
      index += run.length - 1;
      continue;
    }
    if (entry.kind === 'turn' && !isLockedStep(node) && (node.op.kind === 'turn' || node.op.kind === 'rotate')) {
      const turn = turnKindOf(node.op);
      cards.push({
        index: cards.length,
        kind: 'turn-over',
        number: null,
        sentence: turnName(turn, t),
        picture: entryPicture(document, entry, { kind: 'step', step: entry.id, moment: 'after' }, failed),
        step: landed(entry) ? { kind: 'turn', turn } : null,
      });
      continue;
    }
    const target: FoldPullStepTarget = { kind: 'step', step: entry.id, moment: 'before' };
    cards.push({
      index: cards.length,
      kind: 'fold',
      number: entry.number,
      sentence: foldDiagramSentence(t, wordsAt(index)),
      picture: entryPicture(document, entry, target, failed),
      step: landed(entry) ? target : null,
    });
  }
  const tip = entries.at(-1);
  if (tip && tip.id !== null && entries.some((entry) => entry.kind === 'fold')) {
    const target: FoldPullStepTarget = { kind: 'step', step: tip.id, moment: 'after' };
    cards.push({
      index: cards.length,
      kind: 'done',
      number: null,
      sentence: t('panels:diagram.fold.finishedSentence', 'The model as the steps leave it.'),
      picture: entryPicture(document, tip, target, failed),
      step: landed(tip) ? target : null,
    });
  }
  return cards;
}

/** What a pull of Fold targets came to: the entries to add, and how many steps could not be captured. */
export interface FoldPulled {
  sent: SentDiagramEntry[];
  /** Steps that could not be captured (gone, no longer folding, the engine stopped), left out. */
  failed: number;
  /** Steps added unspread, their layers not spreadable ({@link captureFoldTarget}). */
  flattened: number;
}

/** What capturing one step target came to: the capture, and whether it had to be made unspread. */
export interface FoldTargetCapture {
  result: FoldStepCaptureResult;
  /** The render's spread could not be drawn, so this is the capture without it. */
  flattened: boolean;
}

/**
 * Capture a step target as a pull adds it, in `render`; and when its layers
 * cannot be spread — the spread refused or failed, or its picture too
 * detailed to keep as a drawing — again without the spread, so the step is
 * added unspread rather than left out. The browser's cards are captured
 * here too (`foldPullPreviews.ts`), so a card shows the step Add makes.
 */
export async function captureFoldTarget(
  session: FoldSession,
  sequence: string,
  target: FoldPullStepTarget,
  render: Extract<DiagramCpRender, { mode: 'folded-flat' }>,
  options: { t: TFunction; newId?: DiagramIdFactory }
): Promise<FoldTargetCapture> {
  const { through } = target;
  const request = { sequence, step: target.step, ...(through !== undefined ? { through } : {}), moment: target.moment };
  if (!render.spread) return { result: await captureFoldStep(session, { ...request, render }, options), flattened: false };
  try {
    const result = await captureFoldStep(session, { ...request, render }, options);
    if (result.status !== 'captured' || result.captured.kind !== 'over-budget') return { result, flattened: false };
  } catch (error) {
    // Swallowed on purpose: the step is still added, unspread, and the user is told so.
    reportError(error, { surface: 'diagram:fold-pull-spread' });
  }
  const { spread: _spread, ...unspread } = render;
  return { result: await captureFoldStep(session, { ...request, render: unspread }, options), flattened: true };
}

/** A captured Fold step as a pull sends it: its picture, its marks lifted, its words. Null for one with no stored drawing. */
export function sentFoldStep(result: FoldStepCaptureResult): SentFoldStep | null {
  if (result.status !== 'captured' || result.captured.kind !== 'picture' || result.captured.picture.kind !== 'scene') return null;
  const picture = result.captured.picture;
  return {
    source: result.source,
    picture,
    lifted: { picture, annotations: result.marks },
    text: result.source.sentence ?? '',
  };
}

/**
 * What pulling `targets` adds, in order: each step captured from the
 * session's replay folded, as Fold shows it, spread as Fold spreads it or
 * else at the default ({@link foldPullRender}) — its marks lifted, its words
 * the Diagram's — and each turn as a turn. A step whose capture fails is left
 * out and counted; so is one too detailed to keep as a drawing, which a pull
 * has no bitmap for. One that cannot be spread is added unspread, and
 * counted.
 */
export async function pullFoldTargets(
  session: FoldSession,
  sequence: string,
  targets: readonly FoldPullTarget[],
  { t, newId = randomDiagramId }: { t: TFunction; newId?: DiagramIdFactory }
): Promise<FoldPulled> {
  const sent: SentDiagramEntry[] = [];
  let failed = 0;
  let flattened = 0;
  // Held across every capture, so the engine is not started and stopped once a step.
  const release = session.retain();
  try {
    for (const target of targets) {
      if (target.kind === 'turn') {
        sent.push(target.turn);
        continue;
      }
      const render = foldPullRender(session.store.getState().sequence, sequence, target);
      const captured = await captureFoldTarget(session, sequence, target, render, { t, newId });
      const step = sentFoldStep(captured.result);
      if (!step) {
        failed += 1;
        continue;
      }
      if (captured.flattened) flattened += 1;
      sent.push(step);
    }
  } finally {
    release();
  }
  return { sent, failed, flattened };
}

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
 * (`captureFoldStep`); nothing is folded here.
 *
 * React-free and store-free: the session is injected.
 */

import type { TFunction } from 'i18next';
import { isLockedStep, turnKindOf, type FoldSequenceDocument } from '../../fold/document/foldSequenceDocument';
import { foldStateSpread, foldStepSpread } from '../../fold/document/foldStepSpread';
import { foldCardPictureSource, type FoldCardPictureSource } from '../../fold/sequence/foldCardPictureSource';
import type { FoldSequenceView } from '../../fold/sequence/useFoldSequenceView';
import type { FoldSession } from '../../fold/session/foldSession';
import type { TurnKind } from '../../lib/steps/turn';
import { turnName } from '../../lib/steps/turnWords';
import {
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
import { captureFoldStep } from './foldStepCapture';

/**
 * What pulling a Fold card adds: a step at a moment — or a run of steps drawn
 * as one, from `step` through `through`, before the first folds
 * (`foldPrecreaseMerge.ts`) — or a turn between steps.
 */
export type FoldPullTarget =
  | { readonly kind: 'step'; readonly step: string; readonly through?: string; readonly moment: DiagramFoldMoment }
  | { readonly kind: 'turn'; readonly turn: TurnKind };

/**
 * A Fold browser card's picture: the state it lands, as Fold's strip draws
 * it, once landed; `pending` while the replay has still to land it; `none`
 * when nothing will — the step broke, is a newer build's, or the replay
 * stopped short.
 */
export type FoldBrowserPicture =
  | { readonly status: 'landed'; readonly source: FoldCardPictureSource }
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

/** A path entry's picture: its state's once landed, else whether one is still to come. */
function entryPicture(
  document: FoldSequenceDocument,
  entry: FoldSequenceView['entries'][number],
  id: string,
  replayFailed: boolean
): FoldBrowserPicture {
  const source = foldCardPictureSource(entry.session.state, entry.session.fingerprint, foldStepSpread(document, id));
  if (source) return { status: 'landed', source };
  return entry.status === 'pending' && !replayFailed ? PICTURE_PENDING : PICTURE_NONE;
}

/** How a pulled Fold step is shown: folded, as Fold shows it, from the front at no turn. */
export const FOLD_PULL_RENDER: Extract<DiagramCpRender, { mode: 'folded-flat' }> = {
  mode: 'folded-flat',
  side: 'front',
  rotationDeg: 0,
  foldCase: 1,
};

/**
 * How a pulled Fold step is shown, its layers spread as Fold spreads the
 * state it shows (`foldStateSpread`): the state before the step is its
 * parent's picture, the state after it the step's own. None when Fold shows
 * it unspread, or the sequence is not the one given.
 */
export function foldPullRender(
  document: FoldSequenceDocument | null,
  sequence: string,
  target: Pick<Extract<FoldPullTarget, { kind: 'step' }>, 'step' | 'moment'>
): DiagramCpRender {
  const spread = document?.id === sequence ? foldStateSpread(document, target.step, target.moment) : null;
  return spread ? { ...FOLD_PULL_RENDER, spread } : FOLD_PULL_RENDER;
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
 * Each of `merges` — precreases and their mirror images, merged
 * (`foldPrecreaseMerge.ts`) — is one card, the step it becomes: numbered
 * from its first step to its last, the state its last lands as its picture,
 * with every crease on it, its sentence the merged step's, added once every
 * step of it has landed.
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
      cards.push({
        index: cards.length,
        kind: 'fold',
        number: entry.number,
        ...(last.number !== null ? { through: last.number } : {}),
        // The steps it is made from, the mirror left out: its words are said once, for both sides.
        sentence: foldDiagramMergedSentence(t, run.slice(0, -1).map((_, k) => wordsAt(index + k))),
        picture: entryPicture(document, last, last.id!, failed),
        step: run.every(landed) ? { kind: 'step', step: entry.id, through: last.id!, moment: 'before' } : null,
      });
      index += run.length - 1;
      continue;
    }
    const picture = entryPicture(document, entry, entry.id, failed);
    if (entry.kind === 'turn' && !isLockedStep(node) && (node.op.kind === 'turn' || node.op.kind === 'rotate')) {
      const turn = turnKindOf(node.op);
      cards.push({
        index: cards.length,
        kind: 'turn-over',
        number: null,
        sentence: turnName(turn, t),
        picture,
        step: landed(entry) ? { kind: 'turn', turn } : null,
      });
      continue;
    }
    cards.push({
      index: cards.length,
      kind: 'fold',
      number: entry.number,
      sentence: foldDiagramSentence(t, wordsAt(index)),
      picture,
      step: landed(entry) ? { kind: 'step', step: entry.id, moment: 'before' } : null,
    });
  }
  const tip = entries.at(-1);
  if (tip && tip.id !== null && entries.some((entry) => entry.kind === 'fold')) {
    cards.push({
      index: cards.length,
      kind: 'done',
      number: null,
      sentence: t('panels:diagram.fold.finishedSentence', 'The model as the steps leave it.'),
      picture: entryPicture(document, tip, tip.id, failed),
      step: landed(tip) ? { kind: 'step', step: tip.id, moment: 'after' } : null,
    });
  }
  return cards;
}

/** What a pull of Fold targets came to: the entries to add, and how many steps could not be captured. */
export interface FoldPulled {
  sent: SentDiagramEntry[];
  /** Steps that could not be captured (gone, no longer folding, the engine stopped), left out. */
  failed: number;
}

/**
 * What pulling `targets` adds, in order: each step captured from the
 * session's replay folded, as Fold shows it, spread as Fold spreads it
 * ({@link foldPullRender}) — its marks lifted, its words the Diagram's — and each
 * turn as a turn. A step whose capture fails is left out
 * and counted; so is one too detailed to keep as a drawing, which a pull
 * has no bitmap for.
 */
export async function pullFoldTargets(
  session: FoldSession,
  sequence: string,
  targets: readonly FoldPullTarget[],
  { t, newId = randomDiagramId }: { t: TFunction; newId?: DiagramIdFactory }
): Promise<FoldPulled> {
  const sent: SentDiagramEntry[] = [];
  let failed = 0;
  // Held across every capture, so the engine is not started and stopped once a step.
  const release = session.retain();
  try {
    for (const target of targets) {
      if (target.kind === 'turn') {
        sent.push(target.turn);
        continue;
      }
      const render = foldPullRender(session.store.getState().sequence, sequence, target);
      const { through } = target;
      const result = await captureFoldStep(
        session,
        { sequence, step: target.step, ...(through !== undefined ? { through } : {}), moment: target.moment, render },
        { t, newId }
      );
      if (result.status !== 'captured' || result.captured.kind !== 'picture' || result.captured.picture.kind !== 'scene') {
        failed += 1;
        continue;
      }
      const picture = result.captured.picture;
      const step: SentFoldStep = {
        source: result.source,
        picture,
        lifted: { picture, annotations: result.marks },
        text: result.source.sentence ?? '',
      };
      sent.push(step);
    }
  } finally {
    release();
  }
  return { sent, failed };
}

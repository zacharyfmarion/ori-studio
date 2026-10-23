/**
 * The engine's caps on what Fold folds, as one: how many faces a state has
 * (`foldFaceCap.ts`) and how deeply its layers stack (`foldStackCap.ts`).
 * A refusal of either carries its counts; replay keeps them on the step that
 * broke, and every notice — Import CP's dialog, a broken step, a refused
 * fold — words them through here.
 *
 * Pure: no DOM, no store.
 */
import type { TFunction } from 'i18next';
import { foldFaceCapWords, foldFaceCountOf, type FoldFaceCapSubject, type FoldFaceCount } from './foldFaceCap';
import { foldStackCapWords, foldStackDepthOf, type FoldStackDepth } from './foldStackCap';

/** A refusal of one of the caps, with its counts. */
export type FoldCap = ({ readonly kind: 'faces' } & FoldFaceCount) | ({ readonly kind: 'stack' } & FoldStackDepth);

/** What is over a cap: a crease pattern being imported, a stored step, or the fold being made. */
export type FoldCapSubject = FoldFaceCapSubject;

/** The cap a refusal names, with its counts; null for any other refusal, or one without them. */
export function foldCapOf(refusal: { readonly code: string }): FoldCap | null {
  const faces = foldFaceCountOf(refusal);
  if (faces) return { kind: 'faces', ...faces };
  const stack = foldStackDepthOf(refusal);
  return stack ? { kind: 'stack', ...stack } : null;
}

/** A refusal of a cap as a notice says it: its counts, in plain words. */
export function foldCapWords(t: TFunction, cap: FoldCap, subject: FoldCapSubject): { title: string; text: string } {
  return cap.kind === 'faces' ? foldFaceCapWords(t, cap, subject) : foldStackCapWords(t, cap, subject);
}

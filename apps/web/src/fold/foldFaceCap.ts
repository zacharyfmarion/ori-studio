/**
 * How many faces Fold folds, and how it says a crease pattern or a step is
 * over that.
 *
 * The engine's layer order builds tables over every pair of a state's faces,
 * so their memory grows with the square of the faces, and a wasm heap never
 * gives it back: past the cap, an import ran the worker out of memory. The
 * engine refuses more faces than `oristudio_layer_order::MAX_FACES` wherever
 * a state is built — an import (`import_too_many_faces`), and any other state,
 * a fold or a stored step's replay (`too_many_faces`) — before anything is
 * built. This mirrors the cap, so a surface that knows a face count can say so
 * before the user commits (Edit's folded figure in the Import CP picker), and
 * words every one of those refusals alike.
 *
 * Pure: no DOM, no store. Literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';

/** `oristudio_layer_order::MAX_FACES` (`crates/oristudio-layer-order/src/view.rs`); a test keeps them equal. */
export const FOLD_MAX_FACES = 4096;

/** A face count over the cap, and the cap. */
export interface FoldFaceCount {
  readonly faceCount: number;
  readonly limit: number;
}

/** The engine's refusals of a face count over the cap: a state's, and an import's. */
export const FOLD_FACE_CAP_CODES: readonly string[] = ['too_many_faces', 'import_too_many_faces'];

/**
 * The counts a refusal of the face cap carries (its `face_count` and
 * `limit`); null for any other refusal, or one without them.
 */
export function foldFaceCountOf(refusal: { readonly code: string }): FoldFaceCount | null {
  if (!FOLD_FACE_CAP_CODES.includes(refusal.code)) return null;
  const { face_count: faceCount, limit } = refusal as Readonly<Record<string, unknown>>;
  if (typeof faceCount !== 'number' || typeof limit !== 'number') return null;
  return { faceCount, limit };
}

/** Whether `faceCount` faces are over the cap: the counts the engine's refusal would name, or null. */
export function foldOverFaceCap(faceCount: number): FoldFaceCount | null {
  return faceCount > FOLD_MAX_FACES ? { faceCount, limit: FOLD_MAX_FACES } : null;
}

/**
 * The refusal of an import over the cap, as the engine words it
 * (`ImportRefusal::TooManyFaces`): what the Import CP flow says for a face
 * count it knows before the figure crosses to the engine.
 */
export function foldImportFaceCapRefusal({ faceCount, limit }: FoldFaceCount): {
  readonly code: 'import_too_many_faces';
  readonly face_count: number;
  readonly limit: number;
} {
  return { code: 'import_too_many_faces', face_count: faceCount, limit };
}

/**
 * What is over the cap:
 *
 * - `pattern`: a crease pattern being imported, or Edit's folded figure;
 * - `step`: a stored step that no longer replays because of it;
 * - `fold`: the fold being made.
 */
export type FoldFaceCapSubject = 'pattern' | 'step' | 'fold';

/** A refusal of the face cap as a notice says it: the count and the cap, in plain words. */
export function foldFaceCapWords(
  t: TFunction,
  { faceCount, limit }: FoldFaceCount,
  subject: FoldFaceCapSubject
): { title: string; text: string } {
  const title = t('tools:fold.refusal.tooManyFaces.title', 'Too many faces');
  switch (subject) {
    case 'pattern':
      return {
        title,
        text: t(
          'tools:fold.refusal.tooManyFaces.pattern',
          'This crease pattern has {{faceCount, number}} faces, and Fold folds patterns of up to {{limit, number}}. Import a simpler pattern.',
          { faceCount, limit }
        ),
      };
    case 'step':
      return {
        title,
        text: t(
          'tools:fold.refusal.tooManyFaces.step',
          'This step has {{faceCount, number}} faces, more than the {{limit, number}} Fold folds. It and the steps after it can only be deleted.',
          { faceCount, limit }
        ),
      };
    case 'fold':
      return {
        title,
        text: t(
          'tools:fold.refusal.tooManyFaces.fold',
          'This fold would make {{faceCount, number}} faces, more than the {{limit, number}} Fold folds. Fold fewer layers.',
          { faceCount, limit }
        ),
      };
  }
}

/** The picker's note under a source over the cap: its face count beside the cap. */
export function foldFaceCapNote(t: TFunction, { faceCount, limit }: FoldFaceCount): string {
  return t(
    'tools:fold.refusal.tooManyFaces.note',
    '{{faceCount, number}} faces, more than the {{limit, number}} Fold folds',
    { faceCount, limit }
  );
}

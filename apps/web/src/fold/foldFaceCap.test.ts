import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { FOLD_IMPORT_REFUSAL_CODES } from './engine/foldEngineIoWire';
import { FOLD_REFUSAL_CODES } from './engine/foldEngineWire';
import {
  FOLD_FACE_CAP_CODES,
  FOLD_MAX_FACES,
  foldFaceCapNote,
  foldFaceCapWords,
  foldFaceCountOf,
  foldImportFaceCapRefusal,
  foldOverFaceCap,
} from './foldFaceCap';

/** The app's own `t`: the English defaults, numbers written as English writes them. */
const t = i18n.t.bind(i18n) as TFunction;

describe('the face cap', () => {
  it('is the engine’s, and its refusals are codes the engine gives', () => {
    // Vitest runs in the web workspace, two levels under the repository.
    const view = readFileSync(resolve(process.cwd(), '../../crates/oristudio-layer-order/src/view.rs'), 'utf8');
    const rust = /pub const MAX_FACES: usize = (\d+);/.exec(view)?.[1];
    expect(Number(rust)).toBe(FOLD_MAX_FACES);
    const known: readonly string[] = FOLD_REFUSAL_CODES;
    for (const code of FOLD_FACE_CAP_CODES) expect(known, code).toContain(code);
    expect(FOLD_IMPORT_REFUSAL_CODES).toContain('import_too_many_faces');
  });

  it('is over at one face past it, not at it', () => {
    expect(foldOverFaceCap(FOLD_MAX_FACES)).toBeNull();
    expect(foldOverFaceCap(FOLD_MAX_FACES + 1)).toEqual({ faceCount: FOLD_MAX_FACES + 1, limit: FOLD_MAX_FACES });
  });

  it('reads the counts of the cap’s refusals, and of no other', () => {
    expect(foldFaceCountOf({ code: 'import_too_many_faces', face_count: 10000, limit: 4096 } as { code: string })).toEqual({
      faceCount: 10000,
      limit: 4096,
    });
    expect(foldFaceCountOf({ code: 'too_many_faces', face_count: 5000, limit: 4096 } as { code: string })).toEqual({
      faceCount: 5000,
      limit: 4096,
    });
    expect(foldFaceCountOf({ code: 'import_no_order', face_count: 5000, limit: 4096 } as { code: string })).toBeNull();
    // A body without its counts says nothing it cannot back.
    expect(foldFaceCountOf({ code: 'import_too_many_faces' })).toBeNull();
    // What the flow says before asking is what the engine would say.
    expect(foldFaceCountOf(foldImportFaceCapRefusal({ faceCount: 4160, limit: 4096 }))).toEqual({
      faceCount: 4160,
      limit: 4096,
    });
  });

  it('names the count and the cap in plain words', () => {
    const counts = { faceCount: 10000, limit: 4096 };
    expect(foldFaceCapWords(t, counts, 'pattern')).toEqual({
      title: 'Too many faces',
      text: 'This crease pattern has 10,000 faces, and Fold folds patterns of up to 4,096. Import a simpler pattern.',
    });
    expect(foldFaceCapWords(t, counts, 'step').text).toBe(
      'This step has 10,000 faces, more than the 4,096 Fold folds. It and the steps after it can only be deleted.'
    );
    expect(foldFaceCapWords(t, counts, 'fold').text).toBe(
      'This fold would make 10,000 faces, more than the 4,096 Fold folds. Fold fewer layers.'
    );
    expect(foldFaceCapNote(t, counts)).toBe('10,000 faces, more than the 4,096 Fold folds');
  });
});

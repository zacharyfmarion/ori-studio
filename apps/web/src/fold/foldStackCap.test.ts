import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { FOLD_IMPORT_REFUSAL_CODES } from './engine/foldEngineIoWire';
import { FOLD_REFUSAL_CODES } from './engine/foldEngineWire';
import { foldCapOf, foldCapWords } from './foldCaps';
import { FOLD_STACK_CAP_CODES, foldStackCapWords, foldStackDepthOf } from './foldStackCap';

/** The app's own `t`: the English defaults, numbers written as English writes them. */
const t = i18n.t.bind(i18n) as TFunction;

const OVER = { deepest: 1290, triples: 357_349_080, limit: 4_000_000 };

describe('the stacking cap', () => {
  it('is refused under codes the engine gives', () => {
    const known: readonly string[] = [...FOLD_REFUSAL_CODES, ...FOLD_IMPORT_REFUSAL_CODES];
    for (const code of FOLD_STACK_CAP_CODES) expect(known, code).toContain(code);
  });

  it('reads the counts of its refusals, and of no other', () => {
    expect(foldStackDepthOf({ code: 'import_stacked_too_deep', ...OVER } as { code: string })).toEqual(OVER);
    expect(foldStackDepthOf({ code: 'stacked_too_deep', ...OVER } as { code: string })).toEqual(OVER);
    expect(foldStackDepthOf({ code: 'import_no_order', ...OVER } as { code: string })).toBeNull();
    // A body without its counts says nothing it cannot back.
    expect(foldStackDepthOf({ code: 'stacked_too_deep', deepest: 1290 } as { code: string })).toBeNull();
  });

  it('names the deepest stack in plain words', () => {
    expect(foldStackCapWords(t, OVER, 'pattern')).toEqual({
      title: 'Layers stacked too deep',
      text: 'This crease pattern stacks its layers too deeply for Fold to work out their order, up to 1,290 on top of each other. Import a simpler pattern.',
    });
    expect(foldStackCapWords(t, OVER, 'fold').text).toBe(
      'This fold would stack the layers too deeply for Fold to work out their order, up to 1,290 on top of each other. Fold fewer layers.'
    );
  });
});

describe('Fold’s caps, as one', () => {
  it('tells which cap a refusal names, with its counts', () => {
    expect(foldCapOf({ code: 'too_many_faces', face_count: 5000, limit: 4096 } as { code: string })).toEqual({
      kind: 'faces',
      faceCount: 5000,
      limit: 4096,
    });
    expect(foldCapOf({ code: 'stacked_too_deep', ...OVER } as { code: string })).toEqual({ kind: 'stack', ...OVER });
    expect(foldCapOf({ code: 'layer_order' })).toBeNull();
  });

  it('words each cap as its own module does', () => {
    expect(foldCapWords(t, { kind: 'stack', ...OVER }, 'step')).toEqual(foldStackCapWords(t, OVER, 'step'));
    expect(foldCapWords(t, { kind: 'faces', faceCount: 5000, limit: 4096 }, 'step').text).toBe(
      'This step has 5,000 faces, more than the 4,096 Fold folds. It and the steps after it can only be deleted.'
    );
  });
});

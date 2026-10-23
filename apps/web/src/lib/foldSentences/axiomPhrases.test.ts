import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { axiomPhrase, type FoldAxiom } from './axiomPhrases';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('axiomPhrase', () => {
  it('names each axiom by the move a folder makes', () => {
    const axioms: FoldAxiom[] = [1, 2, 3, 4, 5, 6, 7];
    expect(axioms.map((axiom) => axiomPhrase(t, axiom))).toEqual([
      'through two points',
      'point onto point',
      'edge onto edge',
      'perpendicular through a point',
      'point onto a line, through a point',
      'two points onto two lines',
      'point onto a line, perpendicular',
    ]);
  });
});

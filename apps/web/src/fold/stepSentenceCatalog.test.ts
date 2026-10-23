import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { FoldLayerScope } from './stepSentence';
import {
  crimpSentence,
  plainFoldSentence,
  reverseFoldSentence,
  unfoldSentence,
  type PlainFoldSentenceOp,
  type SentenceClause,
  type SentenceLine,
} from './stepSentenceCatalog';

/** One `t()` call as the catalog made it. */
interface Call {
  key: string;
  /** The English default, or the plural defaults by category. */
  defaults: Record<string, string>;
  /** Everything else it passed: the names and the count. */
  values: Record<string, unknown>;
}

/** A `t` that records its call and answers with the key. */
function recorder(): { t: TFunction; last: () => Call } {
  let call: Call | null = null;
  const t = ((key: string, second?: unknown, third?: unknown) => {
    const options = (typeof second === 'object' && second !== null ? second : third) as
      | Record<string, unknown>
      | undefined;
    const defaults: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    if (typeof second === 'string') defaults.default = second;
    for (const [name, value] of Object.entries(options ?? {})) {
      if (name.startsWith('defaultValue_')) defaults[name.slice('defaultValue_'.length)] = String(value);
      else values[name] = value;
    }
    call = { key, defaults, values };
    return key;
  }) as unknown as TFunction;
  return {
    t,
    last: () => {
      if (!call) throw new Error('t was not called');
      return call;
    },
  };
}

// The one pattern every sentence follows in English: the verb, the line, the
// layers. Each key is its own sentence so other languages need not follow it.
const VERBS: Record<PlainFoldSentenceOp, string> = {
  valley: 'Valley fold',
  mountain: 'Mountain fold',
  valleyPrecrease: 'Valley fold and unfold',
  mountainPrecrease: 'Mountain fold and unfold',
};
/** A depth counts from the top for a valley fold and from the bottom for a mountain fold. */
const SIDES: Record<PlainFoldSentenceOp, string> = {
  valley: 'top',
  mountain: 'bottom',
  valleyPrecrease: 'top',
  mountainPrecrease: 'bottom',
};
const LINES: Record<SentenceLine, { clause: string; names: readonly (keyof SentenceClause['names'])[] }> = {
  free: { clause: ' along the line drawn', names: [] },
  crease: { clause: ' along the existing crease', names: [] },
  o1: { clause: ' along the line joining {{a}} and {{b}}', names: ['a', 'b'] },
  o2: { clause: ', bringing {{a}} onto {{b}}', names: ['a', 'b'] },
  o2Half: { clause: ' in half, bringing {{a}} onto {{b}}', names: ['a', 'b'] },
  o3: { clause: ', bringing {{a}} onto {{b}}', names: ['a', 'b'] },
  o3Half: { clause: ' in half, bringing {{a}} onto {{b}}', names: ['a', 'b'] },
  o4: { clause: ' {{b}} onto itself, pivoting on {{a}}', names: ['a', 'b'] },
  o5: { clause: ', pivoting on {{a}}, bringing {{b}} onto {{c}}', names: ['a', 'b', 'c'] },
  o6: { clause: ', bringing {{a}} onto {{b}} and {{c}} onto {{d}}', names: ['a', 'b', 'c', 'd'] },
  o7: { clause: ' {{self}} onto itself so that {{a}} lands on {{b}}', names: ['self', 'a', 'b'] },
};
const OPS = Object.keys(VERBS) as PlainFoldSentenceOp[];
const LINE_KEYS = Object.keys(LINES) as SentenceLine[];
const NAMES: SentenceClause['names'] = { a: 'A', b: 'B', c: 'C', d: 'D', self: 'S' };

describe('the plain-fold sentence catalog', () => {
  it('holds every operation × line × layer scope to one key and one pattern', () => {
    const keys = new Set<string>();
    for (const op of OPS) {
      for (const line of LINE_KEYS) {
        const { clause, names } = LINES[line];
        const base = `${VERBS[op]}${clause}`;
        const expectedNames = Object.fromEntries(names.map((name) => [name, NAMES[name]]));
        const context = `${op}.${line}`;
        const { t, last } = recorder();
        const sentence = (scope: FoldLayerScope) => plainFoldSentence(t, op, { line, names: NAMES }, scope);

        sentence({ kind: 'all' });
        expect(last(), context).toEqual({
          key: `panels:fold.sentence.${op}.${line}.all`,
          defaults: { default: `${base}, through all layers.` },
          values: expectedNames,
        });

        sentence({ kind: 'depth', layers: 3 });
        expect(last(), context).toEqual({
          key: `panels:fold.sentence.${op}.${line}.depth`,
          defaults: {
            one: `${base}, folding only the ${SIDES[op]} layer.`,
            other: `${base}, folding only the ${SIDES[op]} {{count}} layers.`,
          },
          values: { ...expectedNames, count: 3 },
        });

        sentence({ kind: 'flaps', flaps: 2 });
        expect(last(), context).toEqual({
          key: `panels:fold.sentence.${op}.${line}.flaps`,
          defaults: {
            one: `${base}, folding only the flap shown.`,
            other: `${base}, folding only the {{count}} flaps shown.`,
          },
          values: { ...expectedNames, count: 2 },
        });
        for (const scope of ['all', 'depth', 'flaps']) keys.add(`${op}.${line}.${scope}`);
      }
    }
    expect(keys.size).toBe(OPS.length * LINE_KEYS.length * 3);
  });

  it('passes every name its sentence reads, and only those', () => {
    for (const op of OPS) {
      for (const line of LINE_KEYS) {
        const { t, last } = recorder();
        plainFoldSentence(t, op, { line, names: NAMES }, { kind: 'all' });
        const read = [...(last().defaults.default ?? '').matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
        expect(new Set(read), `${op}.${line}`).toEqual(new Set(Object.keys(last().values)));
      }
    }
  });
});

// Compound folds (plan D4), one block per family.
describe('the reverse fold’s sentences', () => {
  const KINDS = { inside: 'Inside reverse fold', outside: 'Outside reverse fold' } as const;
  /** A reverse fold is never "in half": those lines read as their plain forms. */
  const PLAIN: Partial<Record<SentenceLine, SentenceLine>> = { o2Half: 'o2', o3Half: 'o3' };

  it('holds every kind × line × layer scope to one key and one pattern, counting layers from the top', () => {
    const keys = new Set<string>();
    for (const kind of ['inside', 'outside'] as const) {
      for (const line of LINE_KEYS) {
        const keyed = PLAIN[line] ?? line;
        const { clause, names } = LINES[keyed];
        const base = `${KINDS[kind]}${clause}`;
        const expectedNames = Object.fromEntries(names.map((name) => [name, NAMES[name]]));
        const key = `panels:fold.sentence.${kind}Reverse.${keyed}`;
        const { t, last } = recorder();
        const sentence = (scope: FoldLayerScope) => reverseFoldSentence(t, kind, { line, names: NAMES }, scope);

        sentence({ kind: 'all' });
        expect(last(), `${kind}.${line}`).toEqual({
          key: `${key}.all`,
          defaults: { default: `${base}, through all layers.` },
          values: expectedNames,
        });
        sentence({ kind: 'depth', layers: 2 });
        expect(last(), `${kind}.${line}`).toEqual({
          key: `${key}.depth`,
          defaults: {
            one: `${base}, reversing only the top layer.`,
            other: `${base}, reversing only the top {{count}} layers.`,
          },
          values: { ...expectedNames, count: 2 },
        });
        sentence({ kind: 'flaps', flaps: 1 });
        expect(last(), `${kind}.${line}`).toEqual({
          key: `${key}.flaps`,
          defaults: {
            one: `${base}, reversing only the flap shown.`,
            other: `${base}, reversing only the {{count}} flaps shown.`,
          },
          values: { ...expectedNames, count: 1 },
        });
        for (const scope of ['all', 'depth', 'flaps']) keys.add(`${kind}.${keyed}.${scope}`);
      }
    }
    // Two kinds, nine lines (no "in half"), three scopes.
    expect(keys.size).toBe(2 * 9 * 3);
  });
});

describe('the crimp’s sentences', () => {
  const KINDS = { inside: 'Inside crimp', outside: 'Outside crimp' } as const;
  /** A crimp is never "in half", as a reverse fold is not: those lines read as their plain forms. */
  const PLAIN: Partial<Record<SentenceLine, SentenceLine>> = { o2Half: 'o2', o3Half: 'o3' };
  const SECONDS = { free: 'a second line drawn', crease: 'an existing crease' } as const;

  it('holds every kind × first line × second line × layer scope to one key and one pattern, naming both lines', () => {
    const keys = new Set<string>();
    for (const kind of ['inside', 'outside'] as const) {
      for (const line of LINE_KEYS) {
        for (const second of ['free', 'crease'] as const) {
          const keyed = PLAIN[line] ?? line;
          const { clause, names } = LINES[keyed];
          const base = `${KINDS[kind]}${clause}, then back along ${SECONDS[second]} beyond it`;
          const key = `panels:fold.sentence.crimp.${kind}.${keyed}.${second}`;
          const expectedNames = Object.fromEntries(names.map((name) => [name, NAMES[name]]));
          const { t, last } = recorder();
          const sentence = (scope: FoldLayerScope) => crimpSentence(t, kind, { line, names: NAMES }, second, scope);

          sentence({ kind: 'all' });
          expect(last(), `${kind}.${line}.${second}`).toEqual({
            key: `${key}.all`,
            defaults: { default: `${base}, through all layers.` },
            values: expectedNames,
          });
          sentence({ kind: 'depth', layers: 2 });
          expect(last(), `${kind}.${line}.${second}`).toEqual({
            key: `${key}.depth`,
            defaults: {
              one: `${base}, crimping only the top layer.`,
              other: `${base}, crimping only the top {{count}} layers.`,
            },
            values: { ...expectedNames, count: 2 },
          });
          sentence({ kind: 'flaps', flaps: 1 });
          expect(last(), `${kind}.${line}.${second}`).toEqual({
            key: `${key}.flaps`,
            defaults: {
              one: `${base}, crimping only the flap shown.`,
              other: `${base}, crimping only the {{count}} flaps shown.`,
            },
            values: { ...expectedNames, count: 1 },
          });
          for (const scope of ['all', 'depth', 'flaps']) keys.add(`${kind}.${keyed}.${second}.${scope}`);
        }
      }
    }
    // Two kinds, nine first lines (no "in half"), two second lines, three scopes.
    expect(keys.size).toBe(2 * 9 * 2 * 3);
  });
});

describe('the unfold sentences', () => {
  it('names the layers it opens, from the side the fold opens toward', () => {
    const { t, last } = recorder();
    unfoldSentence(t, 'valley', { kind: 'all' });
    expect(last()).toEqual({
      key: 'panels:fold.sentence.unfold.all',
      defaults: { default: 'Unfold along the existing crease, through all layers.' },
      values: {},
    });
    unfoldSentence(t, 'valley', { kind: 'depth', layers: 1 });
    expect(last()).toEqual({
      key: 'panels:fold.sentence.unfold.top',
      defaults: { one: 'Unfold the top layer.', other: 'Unfold the top {{count}} layers.' },
      values: { count: 1 },
    });
    unfoldSentence(t, 'mountain', { kind: 'depth', layers: 2 });
    expect(last()).toEqual({
      key: 'panels:fold.sentence.unfold.bottom',
      defaults: { one: 'Unfold the bottom layer.', other: 'Unfold the bottom {{count}} layers.' },
      values: { count: 2 },
    });
    unfoldSentence(t, 'mountain', { kind: 'flaps', flaps: 1 });
    expect(last()).toEqual({
      key: 'panels:fold.sentence.unfold.flaps',
      defaults: { one: 'Unfold the flap shown.', other: 'Unfold the {{count}} flaps shown.' },
      values: { count: 1 },
    });
  });
});

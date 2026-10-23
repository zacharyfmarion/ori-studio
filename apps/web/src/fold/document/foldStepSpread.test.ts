import { describe, expect, it } from 'vitest';
import type { AffineSpreadOptions, DepthSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  DEFAULT_AFFINE_SPREAD,
  DEFAULT_DEPTH_SPREAD,
  DEFAULT_LAYER_SPREAD,
  DEFAULT_SPREAD_STARTS,
} from '../../cp-workspace/folded/layerSpreadSettings';
import { sequenceOf, step, valleyAt } from './foldSequence.fixtures';
import type { FoldLockedStep, FoldStep, FoldStepSpreadEntry } from './foldSequenceDocument';
import { setFoldStepSpread } from './foldSequenceEdits';
import {
  foldEffectiveSpread,
  foldInheritedSpread,
  foldSpreadStarts,
  foldStateSpread,
  foldStepSpread,
} from './foldStepSpread';

const depth = (amount: number): DepthSpreadOptions => ({ kind: 'depth', amount, toward: 'up' });
const affine = (amount: number): AffineSpreadOptions => ({ ...DEFAULT_AFFINE_SPREAD, amount });

/** Steps a → b → c → d on one path, and a branch b → e, each with the spread given. */
function sequence(spreads: Partial<Record<'a' | 'b' | 'c' | 'd' | 'e', FoldStepSpreadEntry>> = {}) {
  const at = (id: 'a' | 'b' | 'c' | 'd' | 'e', parent: string | null, y: number) =>
    step(id, parent, valleyAt(y), spreads[id] === undefined ? {} : { spread: spreads[id] });
  return sequenceOf([at('a', null, 0.5), at('b', 'a', 0.25), at('c', 'b', 0.75), at('d', 'c', 0.6), at('e', 'b', 0.4)]);
}

describe('the spread a Fold step shows (the Diagram’s rule, along its path)', () => {
  it('is the default with nothing set, so every picture starts flat', () => {
    const document = sequence();
    for (const id of ['a', 'b', 'c', 'd', 'e', null]) expect(foldStepSpread(document, id)).toBeNull();
    expect(foldEffectiveSpread(document, 'c')).toEqual({ spread: null, origin: 'default', from: null });
  });

  it('is the step’s own setting, else the nearest earlier step’s on its path', () => {
    const document = sequence({ b: depth(0.05) });
    expect(foldStepSpread(document, 'a')).toBeNull();
    expect(foldEffectiveSpread(document, 'b')).toEqual({ spread: depth(0.05), origin: 'own', from: 'b' });
    expect(foldEffectiveSpread(document, 'd')).toEqual({ spread: depth(0.05), origin: 'earlier', from: 'b' });
    // A branch from b follows b too: its path runs through it.
    expect(foldStepSpread(document, 'e')).toEqual(depth(0.05));
  });

  it('reaches later steps with off, as with any other setting, until one says otherwise', () => {
    const document = sequence({ b: depth(0.05), c: 'off', d: affine(0.1) });
    expect(foldStepSpread(document, 'c')).toBeNull();
    expect(foldStepSpread(document, 'd')).toEqual(affine(0.1));
    expect(foldStepSpread(sequence({ b: depth(0.05), c: 'off' }), 'd')).toBeNull();
  });

  it('passes over a newer build’s spread, which it cannot show, to an earlier step’s', () => {
    const document = sequence({ a: depth(0.05), b: { unknown: { kind: 'curve' } } });
    expect(foldEffectiveSpread(document, 'b')).toEqual({ spread: depth(0.05), origin: 'earlier', from: 'a' });
  });

  it('takes nothing from a locked step, which shows no picture', () => {
    const locked: FoldLockedStep = { id: 'a', parent: null, unknown: { id: 'a', parent: null, spread: 'off' } };
    const document = sequenceOf([locked, step('b', 'a')]);
    expect(foldStepSpread(document, 'b')).toBeNull();
  });

  it('gives a Diagram picture the spread of the state it shows: the parent’s before, the step’s after', () => {
    const document = sequence({ b: depth(0.05), c: 'off' });
    expect(foldStateSpread(document, 'c', 'before')).toEqual(depth(0.05));
    expect(foldStateSpread(document, 'c', 'after')).toBeNull();
    expect(foldStateSpread(document, 'a', 'before')).toBeNull();
    expect(foldInheritedSpread(document, 'b')).toBeNull();
  });

  it('starts a spread turned on from the steps before it, each kind from the nearest of its kind', () => {
    const document = sequence({ a: affine(0.1), b: depth(0.05), c: 'off' });
    expect(foldSpreadStarts(document, 'd')).toEqual({ any: depth(0.05), depth: depth(0.05), affine: affine(0.1) });
    expect(foldSpreadStarts(document, 'b')).toEqual({ any: affine(0.1), depth: DEFAULT_DEPTH_SPREAD, affine: affine(0.1) });
    expect(foldSpreadStarts(sequence(), 'c')).toEqual(DEFAULT_SPREAD_STARTS);
  });
});

describe('setFoldStepSpread', () => {
  const own = (document: ReturnType<typeof sequence>, id: string) =>
    (document.steps.find((node) => node.id === id) as FoldStep).spread;

  it('sets a step’s own spread, or off, and clears it for null', () => {
    const set = setFoldStepSpread(sequence(), 'c', depth(0.05));
    expect(own(set, 'c')).toEqual(depth(0.05));
    const off = setFoldStepSpread(set, 'c', 'off');
    expect(own(off, 'c')).toBeUndefined();
    expect(own(setFoldStepSpread(off, 'c', null), 'c')).toBeUndefined();
  });

  it('keeps no setting the steps before would give anyway, so off and on again is the document as it was', () => {
    const document = sequence({ b: depth(0.05) });
    expect(setFoldStepSpread(document, 'c', depth(0.05))).toBe(document);
    const off = setFoldStepSpread(document, 'c', 'off');
    const on = setFoldStepSpread(off, 'c', depth(0.05));
    expect(on).toEqual(document);
    expect(own(on, 'c')).toBeUndefined();
    // The default is what a step with nothing before it gives.
    expect(setFoldStepSpread(sequence(), 'a', 'off')).toEqual(sequence());
  });

  it('changes nothing for the setting a step has, and replaces a newer build’s', () => {
    const document = sequence({ c: depth(0.05) });
    expect(setFoldStepSpread(document, 'c', { ...depth(0.05) })).toBe(document);
    const carried = sequence({ c: { unknown: { kind: 'curve' } } });
    expect(own(setFoldStepSpread(carried, 'c', 'off'), 'c')).toBeUndefined();
    expect(own(setFoldStepSpread(carried, 'c', DEFAULT_LAYER_SPREAD), 'c')).toEqual(DEFAULT_LAYER_SPREAD);
  });

  it('edits nothing locked, nor a step it does not hold', () => {
    const locked: FoldLockedStep = { id: 'l', parent: null, unknown: { id: 'l', parent: null, op: { kind: 'twist' } } };
    const document = sequenceOf([locked, step('m', 'l')]);
    expect(setFoldStepSpread(document, 'l', 'off')).toBe(document);
    expect(setFoldStepSpread(document, 'm', 'off')).toBe(document);
    expect(setFoldStepSpread(document, 'gone', 'off')).toBe(document);
  });
});

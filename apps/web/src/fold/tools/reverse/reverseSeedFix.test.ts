import { describe, expect, it } from 'vitest';
import type { FoldChoices, FoldOp } from '../../document/foldSequenceDocument';
import type { FoldReverseAnalysis, FoldReverseAsked } from '../../engine/foldEngineReverseWire';
import type { FoldCrossSection } from '../../engine/foldEngineWire';
import { findReverseSeedFix, narrowerReverseFlaps } from './reverseSeedFix';

/** Two flaps along y = 0.5, measured from its left end: flap 0 from 0.1 to 0.3, flap 1 from 0.6 to 0.9. */
const section: Pick<FoldCrossSection, 'from' | 'to' | 'rows' | 'flaps'> = {
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [
    { faces: [0, 1], witness: [0.2, 0.6] },
    { faces: [2, 3], witness: [0.7, 0.6] },
  ],
  rows: [
    { faces: [0], spans: [[0.1, 0.3]], flap: 0 },
    { faces: [1], spans: [[0.1, 0.3]], flap: 0 },
    { faces: [2], spans: [[0.6, 0.9]], flap: 1 },
    { faces: [3], spans: [[0.6, 0.9]], flap: 1 },
  ],
};
const drawn = [
  { x: 0.15, y: 0.5 },
  { x: 0.25, y: 0.5 },
] as const;
const refusal = (code: 'reverse_kind_infeasible' | 'reverse_no_opening' | 'reverse_tip_not_free') =>
  ({ refusal: { code, kind: 'inside', faces: [] }, fixes: [] }) as never;

describe('narrowerReverseFlaps', () => {
  it('is the drawn flaps when the fold took more and no opening or stacking let its tip turn', () => {
    expect(narrowerReverseFlaps(refusal('reverse_kind_infeasible'), { scope: 'all' }, section, drawn)).toEqual([section.flaps[0]]);
    expect(narrowerReverseFlaps(refusal('reverse_no_opening'), { scope: 'flaps', flaps: section.flaps }, section, drawn)).toEqual([
      section.flaps[0],
    ]);
  });

  it('is null for another refusal, no fewer flaps, a seed by depth, or nothing drawn', () => {
    expect(narrowerReverseFlaps(refusal('reverse_tip_not_free'), { scope: 'all' }, section, drawn)).toBeNull();
    expect(narrowerReverseFlaps(refusal('reverse_kind_infeasible'), { scope: 'flaps', flaps: [section.flaps[0]!] }, section, drawn)).toBeNull();
    // Flaps the seed did not take are no narrower seed.
    expect(narrowerReverseFlaps(refusal('reverse_kind_infeasible'), { scope: 'flaps', flaps: [section.flaps[1]!] }, section, drawn)).toBeNull();
    expect(
      narrowerReverseFlaps(refusal('reverse_kind_infeasible'), { scope: 'depth', at: [0.2, 0.5], scene: { x: 0.2, y: 0.5 }, choice: 1 }, section, drawn)
    ).toBeNull();
    expect(narrowerReverseFlaps(refusal('reverse_kind_infeasible'), { scope: 'all' }, section, null)).toBeNull();
    expect(narrowerReverseFlaps(null, { scope: 'all' }, section, drawn)).toBeNull();
  });
});

describe('findReverseSeedFix', () => {
  const op: FoldOp = { kind: 'inside-reverse', line: { via: 'free', through: [[0, 0.5], [1, 0.5]] }, seed: { scope: 'flaps', at: [[0.2, 0.6]] } };
  const flaps = [section.flaps[0]!];
  const opening = (lower: number) => ({ lower: [lower], upper: [lower + 1], spine: [], across: [], lower_body: [], upper_body: [], stored: { flap: [lower] } });
  const analysis = (choices: number) =>
    ({ flaps: [{ index: 0, flap: flaps[0], openings: Array.from({ length: choices }, (_, k) => opening(k)), none: null, truncated: false }] }) as unknown as FoldReverseAnalysis;
  const asked = (kinds: FoldReverseAsked['kinds'], choices = 1): FoldReverseAsked => ({ analysis: analysis(choices), kinds, opening: choices > 1, orders: [] });

  it('offers the flaps when the tip lands with the kind wanted, or any kind while the tools choose', async () => {
    expect(await findReverseSeedFix(flaps, { op }, async () => asked(['outside']), null)).toEqual({ flaps, opening: 0, ways: 0 });
    expect(await findReverseSeedFix(flaps, { op }, async () => asked(['outside']), 'inside')).toBeNull();
    expect(await findReverseSeedFix(flaps, { op }, async () => asked([]), null)).toBeNull();
    expect(await findReverseSeedFix(flaps, { op }, async () => null, null)).toBeNull();
  });

  it('steps through the ways the tip opens, and takes the first that lands', async () => {
    const asks: (FoldChoices | undefined)[] = [];
    const fix = await findReverseSeedFix(
      flaps,
      { op },
      async (_op, choices) => {
        asks.push(choices);
        if (!choices?.opening) return asked([], 3);
        return asked(asks.length === 3 ? ['inside'] : [], 3);
      },
      null
    );
    expect(fix).toEqual({ flaps, opening: 1, ways: 3 });
    expect(asks).toHaveLength(3);
  });
});

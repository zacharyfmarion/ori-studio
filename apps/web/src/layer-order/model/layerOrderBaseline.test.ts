/**
 * D16 outside the reducer: `openedBaseline` is what the reducer keeps at its
 * open, and `recordNeedsAttentionOf` the one test of a flagged record, so the
 * dialog shell (U4) decides an Apply that changed nothing as the inspector
 * (U10) will.
 */
import { describe, expect, it } from 'vitest';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { applyChangedNothing, openedApplyBlocker, openedBaseline, recordNeedsAttentionOf } from './layerOrderDecisions';
import { applyBlocker } from './layerOrderReducer';
import type { LayerOpenFacts } from './layerOrderEngineFacts';
import { carried, opened, openFactsOf, sidesOf, SPOTS, SPOTS_TWO_OVER_ZERO } from './layerOrderModel.fixtures';

const RESTORED_WHOLE = { outcome: { kind: 'applied' as const }, carried: [] };
const RESTORED_WITH_A_ROW = { outcome: { kind: 'applied' as const }, carried: [carried({ index: 1 })] };

const RECORD: LayerOrderRecord = { faces: [], constraints: [], order: [] };
/** A record its host flagged after an edit. */
const FLAGGED: LayerOrderRecord = { ...RECORD, attention: { reason: 'conflict', count: 1 } };

const CASES: readonly { name: string; facts: LayerOpenFacts; record: LayerOrderRecord | null; matchesHost: boolean }[] = [
  { name: 'the host’s order, held whole', facts: openFactsOf(), record: null, matchesHost: true },
  {
    name: 'the closest fitting order, moved',
    facts: openFactsOf({ openedOn: { kind: 'closest', moved: 2, ignored: 0 } }),
    record: null,
    matchesHost: false,
  },
  {
    name: 'the closest fitting order, moved nothing',
    facts: openFactsOf({ openedOn: { kind: 'closest', moved: 0, ignored: 0 } }),
    record: null,
    matchesHost: true,
  },
  {
    name: 'a record restored whole',
    facts: openFactsOf({ constraints: [[0, 2, 1]], restore: RESTORED_WHOLE }),
    record: RECORD,
    matchesHost: true,
  },
  {
    name: 'a record with a row not applied',
    facts: openFactsOf({ restore: RESTORED_WITH_A_ROW }),
    record: RECORD,
    matchesHost: false,
  },
  { name: 'a record the host flagged', facts: openFactsOf({ restore: RESTORED_WHOLE }), record: FLAGGED, matchesHost: false },
];

describe('what a session opened on (D16)', () => {
  it('a record needs attention only when its host flagged it', () => {
    expect(recordNeedsAttentionOf(null)).toBe(false);
    expect(recordNeedsAttentionOf(RECORD)).toBe(false);
    expect(recordNeedsAttentionOf(FLAGGED)).toBe(true);
  });

  it.each(CASES)('$name: as the reducer keeps it at its open', ({ facts, record, matchesHost }) => {
    // The reducer's init and the shell ask the record the same question.
    const attention = recordNeedsAttentionOf(record);
    const { state } = opened(facts, { hasRecord: record !== null, recordNeedsAttention: attention });
    const baseline = openedBaseline(facts, attention);
    expect(baseline).toEqual(state.baseline);
    expect(baseline.matchesHost).toBe(matchesHost);
  });

  it.each([
    { name: 'an open', facts: openFactsOf(), blocker: null },
    { name: 'a restore applied', facts: openFactsOf({ restore: RESTORED_WITH_A_ROW }), blocker: null },
    {
      name: 'a restore whose rows clash',
      facts: openFactsOf({ restore: { outcome: { kind: 'clash', constraints: [1] }, carried: [carried({ index: 1 })] } }),
      blocker: 'clash',
    },
    {
      name: 'a restore that ran out of time',
      facts: openFactsOf({
        restore: { outcome: { kind: 'timed_out', limit: 'deadline', nodes: 0 }, carried: [carried({ index: 0 })] },
      }),
      blocker: 'unsettled',
    },
  ] as const)('$name: Apply waits as the reducer says at its open (D10)', ({ facts, blocker }) => {
    const { state } = opened(facts, { hasRecord: facts.restore !== null });
    expect(openedApplyBlocker(facts)).toBe(blocker);
    expect(applyBlocker(state)).toBe(blocker);
  });

  it('an Apply on what it opened on changes nothing only when that was the host’s own', () => {
    for (const { facts, record, matchesHost } of CASES) {
      const baseline = openedBaseline(facts, recordNeedsAttentionOf(record));
      const atOpen = { constraints: facts.constraints, carried: baseline.carried, stacks: facts.stacks };
      expect(applyChangedNothing(baseline, atOpen)).toBe(matchesHost);
    }
    // Another order on screen is a change, whatever it opened on.
    const baseline = openedBaseline(openFactsOf(), false);
    expect(applyChangedNothing(baseline, { constraints: [], carried: [], stacks: sidesOf(SPOTS_TWO_OVER_ZERO) })).toBe(false);
    expect(applyChangedNothing(baseline, { constraints: [], carried: [], stacks: sidesOf(SPOTS) })).toBe(true);
  });
});

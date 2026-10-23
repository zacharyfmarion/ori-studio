import { describe, expect, it, vi } from 'vitest';
import type { FoldSegmentPick } from '../../canvas/foldPicking';
import type { FoldVertexOp } from '../../document/foldSequenceDocument';
import type { FoldCompoundAnalysis } from '../../engine/foldEngineCompoundWire';
import type { FoldSwivelEdgeAnalysis, FoldVertexAnalysed } from '../../engine/foldEngineSquashWire';
import type { FoldEngineOutcome } from '../../engine/foldEngineWire';
import {
  SWIVEL_REACH_ASKING,
  swivelImpliedLanding,
  swivelOffered,
  swivelPickedLanding,
  swivelReach,
  swivelReachesNothing,
  swivelReachView,
  type FoldSwivelLanding,
  type FoldSwivelReachAsk,
} from './swivelReach';

/** A swivel by its edge's description, its target the line `target`. */
const analysis = (target = { n: [1, 0] as [number, number], d: 0.5 }): FoldSwivelEdgeAnalysis => ({
  pivot: [0, 0],
  vertex: [0, 0],
  meet: [0, 0],
  edge: [
    [0, 0],
    [1, 0],
  ],
  edge_faces: [0],
  foot: [0, 0],
  target,
  rotation: 0,
  landed: [],
  creases: [],
  ridges: [
    [0, 1],
    [1, 1],
  ],
  ridge: 0,
  layers: [0],
  regions: [],
});

const answered = (answer: Partial<FoldVertexAnalysed> = {}): FoldEngineOutcome<FoldCompoundAnalysis> => ({
  status: 'ok',
  family: 'vertex',
  analysis: { kind: 'swivel-by-edge', ...analysis() },
  emergents: [true, true],
  orders: null,
  ...answer,
});

const refused: FoldEngineOutcome<FoldCompoundAnalysis> = {
  status: 'refused',
  refusal: { code: 'swivel_target_parallel', faces: [0] },
  fixes: [],
  faces: [],
  vertices: [],
};

const lines = (...ids: number[]) => ids.map((id) => ({ id, at: [id / 10, 0] as [number, number] }));

describe('a swivel’s reach', () => {
  it('asks every edge against every other line, and offers on a folded edge a pair that lands another way, folded the folder’s', () => {
    const ask = vi.fn((op: FoldVertexOp) => {
      // Edge 1 onto line 2 folds only as a mountain; every other pair is refused.
      if (!('edge' in op) || op.edge[0] !== 0.1 || op.target.via !== 'crease' || op.target.at[0] !== 0.2) return refused;
      return answered({ emergents: [], directions: [false, true] });
    });
    const request: FoldSwivelReachAsk = { at: { fold: [0.5, 0.5] }, direction: 'valley', edges: lines(1, 3), targets: lines(1, 2, 3) };
    const reach = swivelReach(ask, request);
    // An edge is never asked onto its own line, and a pair once: kept as asked, nothing to ask again.
    expect(ask).toHaveBeenCalledTimes(2 * 2);
    expect(reach.landings).toHaveLength(1);
    const [landing] = reach.landings;
    expect(landing).toMatchObject({ edge: 1, target: 2, directions: [false, true] });
    // The folder's way does not land: kept the folder's way all the same. The
    // click previews it refused, and the refusal offers the other way: never
    // the other way folded without a word (owner feedback, 2026-10-20).
    expect(landing?.op).toMatchObject({ fold: [0.5, 0.5], direction: 'valley' });
  });

  it('offers a free vertex that lands only the other way, kept the folder’s way', () => {
    const ask = vi.fn((op: FoldVertexOp) =>
      'direction' in op && op.direction === 'mountain' ? answered({ emergents: [true, false] }) : answered({ emergents: [false, false] })
    );
    const reach = swivelReach(ask, { at: { pivot: [0.5, 0.5] }, direction: 'valley', edges: lines(1), targets: lines(2) });
    expect(reach.landings).toHaveLength(1);
    expect(reach.landings[0]?.directions).toEqual([false, true]);
    expect(reach.landings[0]?.op).toMatchObject({ direction: 'valley' });
  });

  it('asks a free vertex both ways, keeps the folder’s when it lands, and takes the first ridge that lands', () => {
    const ask = vi.fn((op: FoldVertexOp) => {
      if (!('ridge' in op) || op.ridge === undefined) {
        // As asked, only the end's ridge lands, and only as a valley.
        return 'direction' in op && op.direction === 'valley' ? answered({ emergents: [false, true] }) : answered({ emergents: [false, false] });
      }
      return answered({ emergents: [false, true], analysis: { kind: 'swivel-by-edge', ...analysis(), ridge: 1 } });
    });
    const reach = swivelReach(ask, { at: { pivot: [0.5, 0.5] }, direction: 'valley', edges: lines(1), targets: lines(2) });
    expect(reach.landings).toHaveLength(1);
    const [landing] = reach.landings;
    expect(landing?.directions).toEqual([true, false]);
    expect(landing?.op).toMatchObject({ pivot: [0.5, 0.5], seed: { scope: 'all' }, direction: 'valley', ridge: [1, 1] });
    expect(landing?.answer.analysis).toMatchObject({ ridge: 1 });
  });

  it('offers the edges that swing, then the lines the edge picked lands on, and nothing while asked', () => {
    const landing = (edge: number, target: number, line = { n: [1, 0] as [number, number], d: 0.5 }): FoldSwivelLanding => ({
      edge,
      target,
      directions: [true, false],
      op: { kind: 'swivel', via: 'edge', fold: [0, 0], edge: [0, 0], target: { via: 'crease', at: [0, 0] }, direction: 'valley' },
      answer: { analysis: { kind: 'swivel-by-edge', ...analysis(line) }, emergents: [], orders: null },
    });
    const view = swivelReachView({ landings: [landing(1, 2), landing(1, 4), landing(3, 2), landing(3, 5, { n: [0, 1], d: 0.2 })] });
    const meet = { kind: 'point', provenance: 'fold', sheet: [0, 0], mark: null, scene: null } as const;
    const segment = (edge: number): FoldSegmentPick => ({
      kind: 'segment',
      edge,
      segment: 'raw_edge',
      sheet: [
        [0, 0],
        [1, 0],
      ],
      scene: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    const edges = swivelOffered(view, [meet]);
    expect([1, 2, 3].map((id) => edges?.(id))).toEqual([true, false, true]);
    const targets = swivelOffered(view, [meet, segment(1)]);
    expect([2, 3, 4, 5].map((id) => targets?.(id))).toEqual([true, false, true, false]);
    // After the target, or before the meeting point, the reach decides nothing.
    expect(swivelOffered(view, [meet, segment(1), segment(2)])).toBeNull();
    expect(swivelOffered(null, [meet])).toBeNull();
    // While the worker is asked, nothing is offered.
    expect(swivelOffered(SWIVEL_REACH_ASKING, [meet])?.(1)).toBe(false);
    expect(swivelPickedLanding(view, [meet, segment(3), segment(5)])?.target).toBe(5);
    // Edge 1 lands on two lines that are one line: its swivel is implied; edge 3's lines differ.
    expect(swivelImpliedLanding(view, 1)?.target).toBe(2);
    expect(swivelImpliedLanding(view, 3)).toBeNull();
    expect(swivelReachesNothing(view)).toBe(false);
    expect(swivelReachesNothing(swivelReachView({ landings: [] }))).toBe(true);
    expect(swivelReachesNothing(SWIVEL_REACH_ASKING)).toBe(false);
  });
});

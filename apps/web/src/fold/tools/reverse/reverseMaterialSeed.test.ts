import { describe, expect, it } from 'vitest';
import { bookScene } from '../../canvas/foldCanvas.fixtures';
import { foldPickIndex, resolveFoldPick, type FoldPointPick } from '../../canvas/foldPicking';
import { FOLD_TOOL_INITIAL } from '../foldToolState';
import { reverseMaterialPoint, reverseMaterialSeed } from './reverseMaterialSeed';

const source: FoldPointPick = {
  kind: 'point', pane: 'crease-pattern', sheet: [0, 1], scene: { x: 0, y: 1 }, provenance: 'vertex', mark: null,
};
const tools = { ...FOLD_TOOL_INITIAL, tool: 'inside-reverse' as const, lineMode: 'axiom-2' as const, picks: [source] };

describe('reverse-fold material selected on the CP', () => {
  it('uses only the moving point of Axiom 2; a destination on another layer is just a reference', () => {
    expect(reverseMaterialPoint(tools)).toEqual([0, 1]);
    expect(reverseMaterialPoint({ ...tools, picks: [source, { ...source, sheet: [1, 0] }] })).toEqual([0, 1]);
    expect(reverseMaterialPoint({ ...tools, picks: [{ ...source, pane: 'folded' }, source] })).toBeNull();
    expect(reverseMaterialPoint({ ...tools, picks: [{ ...source, pane: undefined }] })).toBeNull();
    expect(reverseMaterialPoint({ ...tools, lineMode: 'axiom-1' })).toBeNull();
    expect(reverseMaterialPoint({ ...tools, tool: 'valley' })).toBeNull();
    expect(reverseMaterialPoint({ ...tools, swapped: true })).toBeNull();
    expect(reverseMaterialPoint({ ...tools, override: {
      op: { kind: 'inside-reverse', line: { via: 'free', through: [[0, 0], [1, 0]] }, seed: { scope: 'all' } },
    } })).toBeNull();
  });

  it('picks material by sheet polygons, even when another face covers it', () => {
    const scene = bookScene();
    const lower = { faces: [1], witness: [0.25, 0.75] as [number, number] };
    const upper = { faces: [2], witness: [0.75, 0.75] as [number, number] };
    const section = { flaps: [lower, upper] };
    expect(reverseMaterialSeed(scene, section, [0, 1])).toEqual({ scope: 'flaps', flaps: [lower] });
    expect(reverseMaterialSeed(scene, section, [1, 1])).toEqual({ scope: 'flaps', flaps: [upper] });
    // One pocket may have several faces meeting at the source vertex. Its
    // interior witness, rather than that ambiguous vertex, is saved.
    const pocket = { faces: [1, 2], witness: [0.25, 0.75] as [number, number] };
    const other = { faces: [10], witness: [0.1, 0.1] as [number, number] };
    expect(reverseMaterialSeed(scene, { flaps: [pocket, other] }, [0.5, 1]))
      .toEqual({ scope: 'flaps', flaps: [pocket] });
  });

  it('retains the pane for a free point picked with Alt as well as a snapped point', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const pick = resolveFoldPick(index, 'crease-pattern', { x: 0.1, y: 0.9 }, { point: 0.02, line: 0.02 },
      { snap: 'point', edges: true, free: true });
    expect(pick).toMatchObject({ kind: 'point', pane: 'crease-pattern', provenance: 'free' });
    expect(reverseMaterialPoint({ ...tools, picks: pick ? [pick] : [] })).toEqual([0.1, 0.9]);
  });
});

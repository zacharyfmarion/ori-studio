import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectFolded3dModel, folded3dPaperStyle, folded3dBspItems, DEFAULT_FOLDED_3D_CAMERA } from './src/cp-workspace/folded/foldedFigure3dProjection';
import { buildBsp } from '@treemaker/origami-simulator';
const TOL: any = { angle_radians: 1e-7, distance_relative: 1e-6, flat_snap_degrees: 1e-6, overlap_area_relative: 1e-9 };
const MODEL: any = { front_color: { red: 255, green: 255, blue: 100 }, back_color: { red: 60, green: 60, blue: 200 }, line_color: { red: 0, green: 0, blue: 0 }, anti_alias: true, transparent_transparency: 16 };
const m = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-zacharymarion-Documents-code-tree-maker-rust--claude-worktrees-3d-fold-simulation-research-f7c827/f3aa5222-ace9-4786-80cd-3b88cd635d38/scratchpad/penguin.rendermodel.json', 'utf8'));
const opts = (o: any = {}) => ({ camera: DEFAULT_FOLDED_3D_CAMERA, displayStyle: 'Paper5' as const, style: folded3dPaperStyle(MODEL), tolerances: TOL, ...o });
const time = (label: string, n: number, fn: () => void) => { fn(); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return `${label}=${((performance.now() - t0) / n).toFixed(1)}ms`; };
describe('perf', () => {
  it('x', () => {
    const out: string[] = [];
    out.push(`faces=${m.face_count} cells=${m.cell_count} edges=${m.edge_count}`);
    out.push(time('full', 10, () => projectFolded3dModel(m, opts())));
    out.push(time('noCull', 10, () => projectFolded3dModel(m, opts({ cullHidden: false }))));
    out.push(time('noCull+noMerge', 10, () => projectFolded3dModel(m, opts({ cullHidden: false, mergeCoplanar: false }))));
    const items = folded3dBspItems(m, 'Paper5');
    out.push(`items=${items.length}`);
    out.push(time('bspOnly', 10, () => buildBsp(items, { coplanarEpsilon: 4e-4 } as any)));
    expect(out.join(' | ')).toBe('SHOW');
  });
});

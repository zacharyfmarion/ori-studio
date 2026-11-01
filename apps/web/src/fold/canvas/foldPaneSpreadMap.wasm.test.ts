import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cpHitRadiusModel, CP_LINE_HIT_RATIO, CP_POINT_HIT_RATIO } from '../../cp-workspace/snapRadius';
import { DEFAULT_DEPTH_SPREAD, DEFAULT_AFFINE_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import type { Point } from '../../lib/geometry';
import { CP_DEFAULT_SNAP_RADIUS } from '../../lib/cpSnapRadiusSetting';
import type { FoldOp } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldEngineOutcome } from '../engine/foldEngineWire';
import { FOLD_UNITS_PER_CP_UNIT, FOLD_USER_PER_UNIT } from './foldCanvasGeometry';
import { FOLD_PANE_DISPLAY_DEFAULT, foldedPaneScene } from './foldPaneScenes';
import { foldPaneSpreadMap } from './foldPaneSpreadMap';
import { foldPickIndex, resolveFoldPick } from './foldPicking';
import { restingSpread } from './useFoldCanvasPaint';

/**
 * The folded pane picked where it draws the paper, over the real engine's
 * states, in-process: a book fold with its corner valley-folded up, spread by
 * the default affine spread (which holds one face still and moves every other,
 * the flap on top among them) and by depth. Skipped when the bridge has not
 * been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

const valley = (through: [[number, number], [number, number]], moving: [number, number]): FoldOp => ({
  kind: 'valley',
  line: { via: 'free', through },
  moving,
  seed: { scope: 'all' },
});
const BOOK = valley([[0.5, 0], [0.5, 1]], [0.1, 0.5]);
const CORNER = valley([[0.75, 0], [1, 0.25]], [0.95, 0.05]);

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** The user's default snap radius at 100%, in sheet units, as the pane measures it. */
const RADII = {
  point: cpHitRadiusModel(CP_DEFAULT_SNAP_RADIUS, 1, CP_POINT_HIT_RATIO, 6) * FOLD_UNITS_PER_CP_UNIT,
  line: cpHitRadiusModel(CP_DEFAULT_SNAP_RADIUS, 1, CP_LINE_HIT_RATIO, 8) * FOLD_UNITS_PER_CP_UNIT,
};
const POINT = { snap: 'point' as const, edges: true, free: false };

async function bookAndCorner(): Promise<{ calls: FoldEngineCalls; state: number }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const calls = createFoldEngineCalls(new wasm.FoldEngine());
  const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
  const book = landed(calls.step(sheet, BOOK)).state;
  return { calls, state: landed(calls.step(book, CORNER)).state };
}

const near = (a: Point | null | undefined, b: Point, within = 1e-9) =>
  !!a && Math.hypot(a.x - b.x, a.y - b.y) <= within;

describe.skipIf(!available)('the spread folded pane, picked where it is drawn', () => {
  it('maps every face where the painter draws it', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    for (const spread of [DEFAULT_AFFINE_SPREAD, DEFAULT_DEPTH_SPREAD]) {
      const map = foldPaneSpreadMap(scene, spread)!;
      const painted = foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT, undefined, spread);
      let checked = 0;
      for (const item of painted.items) {
        if (item.kind !== 'face' || item.group !== undefined) continue;
        const outline = scene.faces[item.face]!.outline;
        item.rings[0]!.forEach(([x, y], k) => {
          const drawn = { x: x / FOLD_USER_PER_UNIT, y: -y / FOLD_USER_PER_UNIT };
          expect(near(map.onFace(item.face, outline[k]!), drawn, 1e-9), `${spread.kind} face ${item.face} corner ${k}`).toBe(true);
          checked += 1;
        });
      }
      expect(checked).toBeGreaterThan(0);
    }
    expect(foldPaneSpreadMap(scene, null)).toBeNull();
  });

  it('picks the flap’s corner where the default spread draws it, and the face held still where it lies', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    const landmarks = calls.landmarks(state, []);
    const map = foldPaneSpreadMap(scene, DEFAULT_AFFINE_SPREAD)!;
    // The flap's corner, on the bottom layer's sheet at (1, 0.25), lies on the top layer's (0, 0.25).
    const truth = { x: 1, y: 0.25 };
    const drawn = map.sheet([1, 0.25])!;
    expect(Math.hypot(drawn.x - truth.x, drawn.y - truth.y)).toBeGreaterThan(2 * RADII.point);

    // Unspread, the pane finds nothing where the reader sees the corner.
    expect(resolveFoldPick(foldPickIndex(scene, landmarks, []), 'folded', drawn, RADII, POINT)).toBeNull();

    const index = foldPickIndex(scene, landmarks, [], map);
    const flap = resolveFoldPick(index, 'folded', drawn, RADII, POINT);
    expect(flap).toMatchObject({ kind: 'point', sheet: [1, 0.25] });
    // The pick lies where the paper does: the step stores the sheet point, and the flat pane draws it there.
    expect(near(flap?.kind === 'point' ? flap.scene : null, truth, 1e-9)).toBe(true);
    const freeEnd = resolveFoldPick(index, 'folded', drawn, RADII, { ...POINT, snap: 'free', snapFree: true });
    expect(freeEnd).toMatchObject({ kind: 'free', sheet: [1, 0.25] });
    expect(near(freeEnd?.kind === 'free' ? freeEnd.scene : null, truth, 1e-9)).toBe(true);
    // The face held still is where it lies, and so is its corner there.
    expect(resolveFoldPick(index, 'folded', truth, RADII, POINT)).toMatchObject({ kind: 'point', sheet: [0, 0.25] });
  });

  it('picks a top face’s corner where a depth spread draws it', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    const map = foldPaneSpreadMap(scene, DEFAULT_DEPTH_SPREAD)!;
    const index = foldPickIndex(scene, calls.landmarks(state, []), [], map);
    // The book's top edge, at its fold: a top face's corner, moved toward its deeper neighbours.
    const drawn = map.sheet([0.5, 1])!;
    expect(Math.hypot(drawn.x - 0.5, drawn.y - 1)).toBeGreaterThan(RADII.point);
    expect(resolveFoldPick(index, 'folded', drawn, RADII, POINT)).toMatchObject({ kind: 'point', sheet: [0.5, 1] });
  });

  it('reads a free point off the face drawn on top, and draws it back where it was clicked', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    const map = foldPaneSpreadMap(scene, DEFAULT_AFFINE_SPREAD)!;
    const index = foldPickIndex(scene, calls.landmarks(state, []), [], map);
    // Inside the flap as drawn.
    const inFlap = map.sheet([0.95, 0.15])!;
    const pick = resolveFoldPick(index, 'folded', inFlap, RADII, { snap: 'free', edges: false, free: false });
    expect(pick?.kind).toBe('free');
    if (pick?.kind !== 'free') return;
    expect(pick.sheet?.[0]).toBeCloseTo(0.95, 9);
    expect(pick.sheet?.[1]).toBeCloseTo(0.15, 9);
    expect(near(map.sheet(pick.sheet!), inFlap, 1e-9)).toBe(true);
  });

  it('lies flat once a tool has a pick in hand', () => {
    const none = { action: null, analysis: null };
    expect(restingSpread(DEFAULT_AFFINE_SPREAD, none)).toBe(DEFAULT_AFFINE_SPREAD);
    expect(restingSpread(DEFAULT_AFFINE_SPREAD, none, true)).toBeNull();
  });
});

// The worker adapter must keep the material references of the original
// picking path under strong spread, turn-over and offset placement.
import { connectedSpreadSource } from '../../cp-workspace/folded/connectedSpreadSource';
import { foldPickData, hydratePanePick } from './foldPicking';
import { prepareFoldRender, foldPickDrawing } from './foldRenderGeometry';
import type { SpreadSolution } from '@oristudio/layer-spread';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';

describe.skipIf(!available)('worker Fold projection and picking equivalence', () => {
  it('preserves targets and free-point material coordinates across side, offset and spread', async () => {
    const { calls, state } = await bookAndCorner();
    for (const id of [state, landed(calls.step(state, {kind:'turn',axis:'vertical'})).state]) {
      const scene = calls.scene(id), landmarks = calls.landmarks(id, []);
      const source = connectedSpreadSource(scene, true);
      const reference = {plane:[0,0,0] as [number,number,number],center:[0,0,0] as [number,number,number],samples:0,rms:0};
      const solution: SpreadSolution = {version:'normalized-50-v1',heights:source.input.xy.map((_,i)=>.01*Math.sin(i)),references:[reference,reference],diagnostics:{} as SpreadSolution['diagnostics']};
      const prepared = {source,solution};
      const base = foldPickIndex(scene, landmarks, []);
      const renderSource = {scene,landmarks,prepared,marks:[],picking:foldPickData(base)};
      const render = prepareFoldRender(renderSource);
      let bindings: import('./foldPickPreparation').FoldSheetBindings | undefined;
      for (const amount of [0,.00001,.5,2]) {
        const spread = {kind:'connected',version:1,amount,reveal:[1.5,-.8]} as const;
        const recipe = {...spread,reveal:[...spread.reveal] as [number,number]};
        const built = render({spread:recipe,display:FOLD_PANE_DISPLAY_DEFAULT,offset:{x:.23,y:-.71},style:DEFAULT_PAPER_STYLE,ink:{policy:PAPER_STYLE_POLICIES.fold},width:800,height:600,widthPx:2,view:{origin:[0,0],ex:[1,0],ey:[0,1]}});
        bindings = built.payload.bindings ?? bindings;
        // Fit consumes the worker's displayed outline, including offsets and
        // spread; a flat-sheet bound must not make revealed layers disappear.
        const bounds = built.payload.bounds;
        for (const [x,y] of built.payload.positions) {
          const px = (x + .23) * FOLD_USER_PER_UNIT, py = (y + .71) * FOLD_USER_PER_UNIT;
          expect(px).toBeGreaterThanOrEqual(bounds.minX - 1e-7);
          expect(px).toBeLessThanOrEqual(bounds.maxX + 1e-7);
          expect(py).toBeGreaterThanOrEqual(bounds.minY - 1e-7);
          expect(py).toBeLessThanOrEqual(bounds.maxY + 1e-7);
        }
        const oldMap = foldPaneSpreadMap(scene, recipe, prepared)!;
        const map = foldPaneSpreadMap(scene, recipe, prepared, bindings, foldPickDrawing(renderSource,built.payload.positions))!;
        const expected = foldPickIndex(scene,landmarks,[],oldMap);
        const actual = {...base,spread:map,folded:hydratePanePick(built.payload.folded)};
        expect(actual.folded.points.length).toBe(expected.folded.points.length);
        actual.folded.points.forEach((p,k)=>{
          const q=expected.folded.points[k]!;
          expect({...p,at:q.at}).toEqual(q);
          expect(Math.hypot(p.at.x-q.at.x,p.at.y-q.at.y)).toBeLessThan(1e-12);
          const found=resolveFoldPick(actual,'folded',p.at,RADII,POINT);
          expect(found?.kind).toBe('point');
        });
        expect(actual.folded.segments).toEqual(expected.folded.segments);
        for (const face of scene.faces) {
          const mid = face.outline.reduce((a,p)=>({x:a.x+p.x/face.outline.length,y:a.y+p.y/face.outline.length}),{x:0,y:0});
          const at=oldMap.onFace(scene.faces.indexOf(face),mid);
          const old=oldMap.under(at), now=map.under(at);
          expect(now?.face).toBe(old?.face);
          if(old&&now) expect(Math.hypot(old.sheet[0]-now.sheet[0],old.sheet[1]-now.sheet[1])).toBeLessThan(1e-10);
        }
      }
    }
  });
});

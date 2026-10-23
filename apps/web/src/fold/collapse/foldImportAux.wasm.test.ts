import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldPickIndex, resolveFoldPick } from '../canvas/foldPicking';
import { creasePatternPaneLines } from '../canvas/foldCreasePatternLines';
import { FOLD_PANE_DISPLAY_DEFAULT, foldedPaneScene } from '../canvas/foldPaneScenes';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineIoCalls } from '../engine/foldEngineIoCalls';
import type { FoldEngineOutcome } from '../engine/foldEngineWire';
import { buildFoldStep } from '../tools/foldStepBuilder';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { isLockedStep } from '../document/foldSequenceDocument';

const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
function ok<T>(result: FoldEngineOutcome<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result.refusal));
  return result;
}

// A book fold with a full cyan line across both halves and a partial cyan
// line inside one face. Neither line is a hinge in the collapsed result.
const source = JSON.stringify({
  vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [0.5, 1],
    [0, 0.25], [1, 0.25], [0.2, 0.65], [0.4, 0.65]],
  edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [6, 7], [8, 9]],
  edges_assignment: ['B', 'B', 'B', 'B', 'V', 'F', 'F'],
});

describe.skipIf(!existsSync(WASM))('imported auxiliary precreases through the real bridge and tools', () => {
  it('persists full and partial flat lines, exposes both panes, and folds along a selected line', async () => {
    const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    const bridge = new wasm.FoldEngine();
    const calls = createFoldEngineCalls(bridge);
    const io = createFoldEngineIoCalls(bridge);
    const opened = ok(io.importCp({ format: 'fold', text: source }, { kind: 'empty', startSide: 'front' }));
    expect(opened.count).toEqual({ orders: 1, exact: true });
    expect(opened.summary).toMatchObject({ precreases: 2, unknown_letters: 0, guides: [] });
    const imported = ok(io.importPick(opened.import, []));
    const scene = calls.scene(imported.state);
    expect(scene.faces).toHaveLength(2);
    expect(scene.crease_marks).toHaveLength(2);
    expect(scene.crease_marks!.flatMap((m) => m.pieces)).toHaveLength(3);
    const painted = creasePatternPaneLines(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, step: 1, instruction: null });
    expect(painted.creases.filter((line) => line.color === 'Cyan3')).toHaveLength(2);
    expect(painted.instruction).toHaveLength(1); // only the active valley
    expect(foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT).items.some((item) => item.kind === 'line' && item.role === 'aux')).toBe(true);

    // Save/open the native sequence payload, then replay with a new engine.
    const document = sequenceOf([step('collapse', null, imported.op)]);
    const saved = JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }));
    const reopened = readFoldSequence(JSON.parse(saved))!.document.steps[0]!;
    if (isLockedStep(reopened)) throw new Error('locked collapse');
    const fresh = createFoldEngineCalls(new wasm.FoldEngine());
    const sheet = ok(fresh.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const replayed = ok(fresh.step(sheet, reopened.op));
    expect(replayed.fingerprint).toBe(imported.fingerprint);
    expect(fresh.scene(replayed.state).crease_marks).toEqual(scene.crease_marks);

    const index = foldPickIndex(scene, calls.landmarks(imported.state, []), []);
    for (const pane of ['folded', 'crease-pattern'] as const) {
      const targets = pane === 'folded' ? index.folded : index.creasePattern;
      const marks = targets.segments.filter((s) => s.creaseMark);
      expect(marks.length).toBeGreaterThan(0);
      // Use the full mark's stretch on one face, just as the pointer does.
      const mark = marks.find((m) => Math.hypot(m.sheet[1][0] - m.sheet[0][0], m.sheet[1][1] - m.sheet[0][1]) > 0.4)!;
      const at = pane === 'folded'
        ? { x: (mark.scene[0].x + mark.scene[1].x) / 2, y: (mark.scene[0].y + mark.scene[1].y) / 2 }
        : { x: (mark.sheet[0][0] + mark.sheet[1][0]) / 2, y: (mark.sheet[0][1] + mark.sheet[1][1]) / 2 };
      const pick = resolveFoldPick(index, pane, at, { point: 0.01, line: 0.01 },
        { snap: 'crease-required', edges: false, free: false });
      expect(pick).toMatchObject({ kind: 'segment', segment: 'crease', creaseMark: true });
      if (!pick) throw new Error('missing precrease');
      for (const kind of ['valley', 'mountain'] as const) {
        const built = buildFoldStep({ kind, lineMode: 'crease', picks: [pick], candidate: null,
          swapped: false, seed: { scope: 'all' }, precreaseDirection: 'valley' }, index);
        if (built.status !== 'built') throw new Error(JSON.stringify(built));
        const folded = ok(calls.step(imported.state, built.op, built.choices));
        expect(calls.scene(folded.state).crease_marks).toHaveLength(1);
        const afterSave = JSON.parse(JSON.stringify(built.op));
        expect(ok(fresh.step(replayed.state, afterSave, built.choices)).fingerprint).toBe(folded.fingerprint);
      }
    }
  });
});

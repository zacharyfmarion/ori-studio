/**
 * Registry invariant test (spec §6.5 layer 2). This is the automated guard that a
 * per-tool model decision cannot silently drift: it checks that every UI command
 * has exactly one input-model entry and that the declared point/line counts match
 * the command's actual `toolSteps`. If someone adds a tool, changes its steps, or
 * mistypes a count, this test — not a user in the browser — catches it.
 */
import { describe, expect, it } from 'vitest';
import { ORISTUDIO_CP_COMMANDS } from '../../lib/oristudioCpCommands';
import {
  CP_INPUT_MODELS,
  cpInputModel,
  type CpInputModel,
  type CpStepSnap,
} from './inputModelRegistry';

const POINT_MODELS: CpInputModel[] = ['point-sequence', 'axis-from-line'];
const SNAP_KINDS: CpStepSnap[] = ['point', 'crease', 'crease-required', 'candidate'];

// Only `ready()` commands drive the pointer-tool dispatch; `not-implemented` /
// `porting` stubs (Fold, ImportFold, FoldingEstimate, …) never do, so the registry
// deliberately does not cover them.
const TOOL_COMMANDS = ORISTUDIO_CP_COMMANDS.filter((c) => c.uiStatus === 'ready');

describe('CP input-model registry', () => {
  it('covers every ready tool command exactly once', () => {
    const missing = TOOL_COMMANDS.filter((c) => !cpInputModel(c.operationId)).map(
      (c) => c.operationId
    );
    expect(missing).toEqual([]);
  });

  it('has no entries for operations that are not ready tool commands', () => {
    const known = new Set(TOOL_COMMANDS.map((c) => c.operationId));
    const orphans = Object.keys(CP_INPUT_MODELS).filter((op) => !known.has(op as never));
    expect(orphans).toEqual([]);
  });

  it('point-model pointCount matches the command step count', () => {
    const mismatches: string[] = [];
    for (const command of TOOL_COMMANDS) {
      const entry = cpInputModel(command.operationId);
      if (!entry || !POINT_MODELS.includes(entry.model)) continue;
      const steps = command.toolSteps?.length ?? 0;
      if (entry.pointCount !== steps) {
        mismatches.push(`${command.operationId}: pointCount=${entry.pointCount} steps=${steps}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('point-model snapPerStep is present, one entry per point, all valid kinds', () => {
    const bad: string[] = [];
    for (const [op, entry] of Object.entries(CP_INPUT_MODELS)) {
      if (!entry || !POINT_MODELS.includes(entry.model)) continue;
      const snap = entry.snapPerStep;
      if (!snap) {
        bad.push(`${op}: missing snapPerStep`);
        continue;
      }
      if (snap.length !== entry.pointCount) {
        bad.push(`${op}: snapPerStep.length=${snap.length} pointCount=${entry.pointCount}`);
      }
      const invalid = snap.filter((k) => !SNAP_KINDS.includes(k));
      if (invalid.length) bad.push(`${op}: invalid snap kinds ${JSON.stringify(invalid)}`);
    }
    expect(bad).toEqual([]);
  });

  it('only point/axis models carry snapPerStep', () => {
    const stray = Object.entries(CP_INPUT_MODELS)
      .filter(([, e]) => e?.snapPerStep && !POINT_MODELS.includes(e.model))
      .map(([op]) => op);
    expect(stray).toEqual([]);
  });

  it('line-entity entries declare a positive lineCount', () => {
    const bad: string[] = [];
    for (const [op, entry] of Object.entries(CP_INPUT_MODELS)) {
      if (entry?.model !== 'line-entity') continue;
      if (!entry.lineCount || entry.lineCount < 1) bad.push(op);
    }
    expect(bad).toEqual([]);
  });

  it('only point/axis models carry pointCount; only line-entity carries lineCount', () => {
    const bad: string[] = [];
    for (const [op, entry] of Object.entries(CP_INPUT_MODELS)) {
      if (!entry) continue;
      const isPoint = POINT_MODELS.includes(entry.model);
      if (entry.pointCount !== undefined && !isPoint) bad.push(`${op}: stray pointCount`);
      if (entry.lineCount !== undefined && entry.model !== 'line-entity') {
        bad.push(`${op}: stray lineCount`);
      }
    }
    expect(bad).toEqual([]);
  });
});

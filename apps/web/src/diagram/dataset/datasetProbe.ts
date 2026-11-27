/**
 * The aux edit probe: does a step's link follow what an aux line does to its
 * picture? Test-only.
 *
 * On a fresh copy of the pattern, for each sheet that crease-pattern steps
 * link to:
 *
 * 1. Every step on the sheet is refreshed, so its link carries this build's
 *    fingerprint.
 * 2. One short aux line goes in strictly inside a face of the sheet
 *    (`probeSegment`), drawn as the Line tool draws one.
 * 3. The snapshot and the sheet index are made again, and each step is
 *    captured again from its refreshed link.
 *
 * The rule, both ways: a step whose capture changed must read out of date,
 * and one whose capture did not must still read current. Bug 2 broke the
 * first half (an aux edit never marks a folded step out of date); a fix
 * must not break the second. Simulated steps above 0% need Pose, and are
 * skipped.
 */
import type { PaperScene } from '@treemaker/origami-simulator';
import { knownCreasesOf } from '../capture/captureCreases';
import { linkStatus, stepSheet } from '../capture/linkStatus';
import type { CaptureStepResult } from '../capture/captureFolded';
import type { DiagramCpSource, DiagramDocument, DiagramStep } from '../document/diagramDocument';
import type { SanitizeEnv } from '../upload/svgSanitize';
import { captureForRefresh, captureSkipReason } from './datasetCapture';
import { sha256 } from './datasetCorpus';
import { cpKernel, freePattern, loadPattern, reread } from './datasetKernel';
import type { ProbeRecord } from './datasetResults';
import { probeSegment } from './probeSegment';

/** What a capture drew, as one string: equal for the same picture. */
function drawn(result: Extract<CaptureStepResult, { status: 'captured' }>): string {
  const { captured } = result;
  if (captured.kind === 'over-budget') return `over-budget:${sha256(JSON.stringify(captured.scene satisfies PaperScene))}`;
  const { picture } = captured;
  return picture.kind === 'scene' ? picture.key : `${picture.kind}:${picture.key}`;
}

export async function auxProbe(
  cpDocument: unknown,
  diagram: DiagramDocument,
  steps: readonly DiagramStep[],
  env?: SanitizeEnv
): Promise<Map<string, ProbeRecord>> {
  const records = new Map<string, ProbeRecord>();
  const skip = (step: DiagramStep, reason: string) => records.set(step.id, { outcome: 'skipped', reason });
  const index = await loadPattern(cpDocument);
  const bySheet = new Map<number, DiagramStep[]>();
  try {
    for (const step of steps) {
      if (step.source?.kind !== 'cp') continue;
      const reason = captureSkipReason(step);
      if (reason) {
        skip(step, reason);
        continue;
      }
      const source = step.source;
      if (source.render.mode === 'simulated' || source.render.mode === 'defox') {
        skip(step, 'it needs Pose to be captured again');
        continue;
      }
      const sheet = stepSheet(source.scope, knownCreasesOf(source), index.document, index.sheets);
      if (!sheet) {
        skip(step, 'its sheet is not found');
        continue;
      }
      const list = bySheet.get(sheet.id) ?? [];
      list.push(step);
      bySheet.set(sheet.id, list);
    }
  } finally {
    await freePattern(index);
  }

  for (const [sheetId, onSheet] of bySheet) {
    const pattern = await loadPattern(cpDocument);
    try {
      const refreshed = new Map<string, { source: DiagramCpSource; drawn: string }>();
      for (const step of onSheet) {
        const { result, error } = await captureForRefresh(pattern, diagram, step, env ? { env } : {});
        if (!result || result.status !== 'captured') {
          skip(step, `it could not be refreshed first (${result?.status ?? error ?? 'unknown'})`);
          continue;
        }
        refreshed.set(step.id, { source: result.source, drawn: drawn(result) });
      }
      const segment = sheetId < pattern.sheets.sheetCount ? probeSegment(await pattern.sheetFold(sheetId)) : null;
      if (!segment) {
        for (const step of onSheet) if (refreshed.has(step.id)) skip(step, 'its sheet has no face to draw in');
        continue;
      }
      // As the Line tool draws an aux line: DrawCreaseFree in the aux colour. Inside a face it crosses
      // nothing, so it splits nothing.
      await cpKernel().executeCommand(pattern.handle, 'DrawCreaseFree', { points: [segment.a, segment.b], line_color: 'Cyan3' });
      const edited = await reread(pattern);
      const added = edited.document.crease_pattern.line_segments.length - pattern.document.crease_pattern.line_segments.length;
      if (added !== 1) {
        for (const step of onSheet) if (refreshed.has(step.id)) skip(step, `the probe's line went in as ${added} lines, not one`);
        continue;
      }
      for (const step of onSheet) {
        const before = refreshed.get(step.id);
        if (!before) continue;
        const { result, error } = await captureForRefresh(edited, diagram, step, { source: before.source, ...(env ? { env } : {}) });
        if (!result || result.status !== 'captured') {
          skip(step, `it could not be captured after the edit (${result?.status ?? error ?? 'unknown'})`);
          continue;
        }
        const captureChanged = drawn(result) !== before.drawn;
        const statusAfter = linkStatus(before.source, edited.document, edited.sheets);
        const problem =
          captureChanged && statusAfter === 'current'
            ? 'an aux line added inside its sheet changes its picture, but the step still reads current'
            : !captureChanged && statusAfter === 'stale'
              ? 'an aux line added inside its sheet leaves its picture as it was, but the step reads out of date'
              : null;
        records.set(step.id, { outcome: 'checked', captureChanged, statusAfter, problem });
      }
    } finally {
      await freePattern(pattern);
    }
  }
  return records;
}

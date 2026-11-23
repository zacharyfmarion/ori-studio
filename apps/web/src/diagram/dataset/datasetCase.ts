/**
 * One corpus file, run through every Phase 1 check. Test-only.
 *
 * The file is opened as the app opens it (`openCorpusProject`), its crease
 * pattern loaded into the kernel, and then, per step: the stored picture
 * repainted, the link's status read, the step captured again as Refresh
 * would, and an unspread 3D step's window checked. The aux edit probe runs
 * last, on fresh copies of the pattern. A check that throws is recorded on
 * the case, never fatal to the run.
 */
import type { FoldDocument } from '../../engine/types';
import { isStep, type DiagramStep } from '../document/diagramDocument';
import { captureRecord, captureSkipReason, windowCheck } from './datasetCapture';
import { caseText, sha256, type CorpusCase } from './datasetCorpus';
import { checkFile, openCorpusProject } from './datasetFile';
import { freePattern, loadPattern, type LoadedPattern } from './datasetKernel';
import { repaintStep } from './datasetPaint';
import { hasPoseView, poseCheck, type PoseStoreInputs } from './datasetPose';
import { auxProbe } from './datasetProbe';
import type { CaptureRecord, CaseResult, ResultsWriter, StepResult } from './datasetResults';
import { statusRecords } from './datasetStatus';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runCase(dir: string, kase: CorpusCase, writer: ResultsWriter): Promise<CaseResult> {
  const started = performance.now();
  const failed = (error: unknown, partial: Partial<CaseResult> = {}): CaseResult => ({
    slug: kase.slug,
    sha256: kase.sha256,
    outcome: 'failed',
    error: message(error),
    loadMs: 0,
    totalMs: Math.round(performance.now() - started),
    style: null,
    file: null,
    steps: [],
    ...partial,
  });
  let pattern: LoadedPattern | null = null;
  try {
    const text = caseText(dir, kase);
    const opened = openCorpusProject(text);
    const file = checkFile(text, opened, kase, (name, contents) => writer.writeGz(`cases/${kase.slug}/${name}`, contents));
    const diagram = opened.diagram;
    if (!diagram) return failed(new Error('the file holds no diagram this build can read'), { file });
    pattern = opened.creasePattern ? await loadPattern(opened.creasePattern) : null;
    const loadMs = Math.round(performance.now() - started);
    const statuses = statusRecords({
      diagram,
      document: pattern?.document ?? null,
      sheets: pattern?.sheets ?? null,
      sequences: opened.foldSequences,
    });
    const steps: StepResult[] = [];
    const folder = (step: DiagramStep) => `cases/${kase.slug}/${step.id}`;
    // What the store reads of the project when Pose builds a simulated model.
    const companion = opened.project.workspace.creasePattern;
    const poseStore: PoseStoreInputs = {
      extensions: companion?.extensions ?? {},
      sourceFold: (companion?.creasePattern.sourceFold ?? null) as FoldDocument | null,
    };
    let number = 0;
    for (const entry of diagram.steps) {
      if (!isStep(entry)) continue;
      number += 1;
      const step = entry;
      let repaint: StepResult['repaint'];
      try {
        const painted = repaintStep(step, diagram);
        const record = (svg: string | null, name: string) =>
          svg === null ? null : { svg: writer.writeGz(`${folder(step)}/${name}.svg`, svg), sha256: sha256(svg) };
        repaint = { picture: record(painted.svg, 'repaint'), zoomed: record(painted.zoomed, 'zoomed') };
      } catch (error) {
        repaint = { error: message(error) };
      }
      let capture: CaptureRecord;
      let window: StepResult['window'] = null;
      if (step.source?.kind === 'cp' && !pattern) {
        capture = { outcome: 'skipped', reason: 'the project has no crease pattern' };
      } else if (!pattern) {
        capture = { outcome: 'skipped', reason: captureSkipReason(step) ?? 'nothing to capture' };
      } else {
        const captured = await captureRecord(pattern, diagram, step, (json) => writer.writeGz(`${folder(step)}/capture.json`, json));
        capture = captured.record;
        if (captured.record.outcome === 'captured') {
          try {
            window = await windowCheck(pattern, diagram, step);
          } catch (error) {
            window = { error: message(error) };
          }
        }
      }
      const pose: StepResult['pose'] = !hasPoseView(step)
        ? null
        : pattern
          ? await poseCheck(pattern, poseStore, diagram, step, (name, png) => writer.writeBytes(`${folder(step)}/${name}`, png))
          : { skipped: 'the project has no crease pattern' };
      const source = step.unknown ? 'locked' : (step.source?.kind ?? 'empty');
      const render = step.source && 'render' in step.source ? (step.source.render?.mode ?? null) : null;
      const spread =
        step.source && 'render' in step.source && step.source.render && 'spread' in step.source.render
          ? (step.source.render.spread?.kind ?? null)
          : null;
      steps.push({
        id: step.id,
        number,
        source,
        render,
        spread,
        storedKey: step.picture?.key ?? null,
        repaint,
        status: statuses.get(step.id) ?? null,
        capture,
        window,
        probe: null,
        pose,
      });
    }
    if (opened.creasePattern) {
      const probes = await auxProbe(opened.creasePattern, diagram, diagram.steps.filter(isStep));
      for (const step of steps) step.probe = probes.get(step.id) ?? null;
    }
    return {
      slug: kase.slug,
      sha256: kase.sha256,
      outcome: 'ran',
      loadMs,
      totalMs: Math.round(performance.now() - started),
      style: diagram.style,
      file,
      steps,
    };
  } catch (error) {
    return failed(error);
  } finally {
    if (pattern) await freePattern(pattern);
  }
}

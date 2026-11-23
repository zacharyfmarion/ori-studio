import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaperLineItem, PaperScene } from '@treemaker/origami-simulator';
import type { OwnPaperRecord } from '../../cp-workspace/folded/folded3dWindowParity.testSupport';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { diffResults, summaryLine, writeReport } from './datasetReport';
import {
  RESULTS_FORMAT,
  RESULTS_VERSION,
  ResultsWriter,
  type CaptureRecord,
  type DatasetResults,
  type PoseRecord,
  type StepResult,
} from './datasetResults';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diagram-corpus-report-'));
  dirs.push(dir);
  return dir;
}

const line = (role: PaperLineItem['role'], x: number): PaperLineItem => ({
  kind: 'line',
  role,
  a: [x, 0],
  b: [x, 10],
  onBoundary: [false, false],
  hidden: false,
});
const scene = (...items: PaperScene['items']): PaperScene => ({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, sheet: 400, items });
function captured(writer: ResultsWriter, id: string, picture: PaperScene, overrides: Partial<Extract<CaptureRecord, { outcome: 'captured' }>> = {}): CaptureRecord {
  const json = JSON.stringify(picture);
  return {
    outcome: 'captured',
    key: `scene-${json.length}-${json.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}`,
    paperFacesSha256: 'faces',
    sourceSha256: 'source',
    fingerprint: 'rc1:same',
    orderFreeSha256: 'n/a',
    counts: {},
    spreadFailed: false,
    noLayerOrder: false,
    ms: 5,
    timingSensitive: false,
    scene: writer.writeGz(`capture/${id}.json`, json),
    ...overrides,
  };
}

function step(id: string, capture: CaptureRecord, extra: Partial<StepResult> = {}): StepResult {
  return {
    id,
    number: Number(id.replace(/\D/g, '')) || 1,
    source: 'cp',
    render: 'folded-flat',
    spread: null,
    storedKey: null,
    repaint: { picture: null, zoomed: null },
    status: { link: 'current', refresh: null, lightingChanged: false, readSha256: 'read' },
    capture,
    window: null,
    probe: null,
    pose: null,
    ...extra,
  };
}

const counts = (foreign: OwnPaperRecord['foreign'] = {}): OwnPaperRecord => ({
  foreign,
  foreignLines: {},
  gaps: {},
  gapLines: {},
  ink: {},
  samples: {},
  unchecked: 0,
});

/** A simulated step's Pose record: its live view's aux ink over paper not its own, by camera; none when the replay refused it. */
function pose(writer: ResultsWriter, id: string, auxByCamera: number[], extra: Partial<PoseRecord> = {}): PoseRecord {
  const refused = extra.liveRefused !== undefined;
  return {
    view: 'simulated',
    frame: 're-solved',
    solve: { steps: 1000, settled: true },
    shape: 'none',
    draws: { perspective: [false], creaseBias: [0.0008], creaseWritesDepth: [true], shaders: 'digest' },
    cameras: auxByCamera.map((aux, index) => ({
      name: index === 0 ? 'saved' : `ring ${index}`,
      live: refused ? null : counts(aux > 0 ? { aux } : {}),
      liveImage: refused ? null : writer.writeBytes(`${id}/pose-${index}-live.png`, new Uint8Array([index])),
      picture: counts(),
      pictureImage: writer.writeBytes(`${id}/pose-${index}-picture.png`, new Uint8Array([index])),
    })),
    ...extra,
  };
}

function results(label: string, steps: StepResult[]): DatasetResults {
  return {
    format: RESULTS_FORMAT,
    version: RESULTS_VERSION,
    label,
    node: 'v22',
    bridges: {},
    startedAt: '',
    finishedAt: '',
    corpus: { dir: '/corpus', manifestSha256: 'm' },
    skippedCases: [],
    cases: [{ slug: 'case', sha256: 'f', outcome: 'ran', loadMs: 1, totalMs: 1, style: DEFAULT_DIAGRAM_STYLE, file: null, steps }],
  };
}

describe('diffResults', () => {
  it('lists only what changed, each with its reason, and keeps problems on both sides apart', () => {
    const beforeDir = tempDir();
    const afterDir = tempDir();
    const a = new ResultsWriter(beforeDir);
    const b = new ResultsWriter(afterDir);
    const window = (aux: number) => ({ painted: 100, paper: 0, missingInk: 0, strayInk: aux ? { aux } : {}, strayLines: aux ? { aux: 1 } : {} });
    const before = results('before', [
      step('s1', captured(a, 's1', scene(line('valley', 1), line('aux', 2)))),
      step('s2', captured(a, 's2', scene(line('valley', 1), line('aux', 2)))),
      step('s3', captured(a, 's3', scene(line('valley', 1))), { status: { link: 'current', refresh: null, lightingChanged: false, readSha256: 'read' } }),
      step('s4', captured(a, 's4', scene(line('valley', 1))), { render: 'folded-3d', window: window(0) }),
      step('s5', captured(a, 's5', scene(line('valley', 1))), { probe: { outcome: 'checked', captureChanged: true, statusAfter: 'current', problem: 'still reads current' } }),
      step('s6', captured(a, 's6', scene(line('valley', 1)))),
      step('s7', captured(a, 's7', scene(line('valley', 1)), { timingSensitive: true })),
      step('s8', { outcome: 'not-captured', status: 'needs-pose', ms: 1 }, { render: 'simulated', pose: pose(a, 's8', [0, 0]) }),
      step('s9', { outcome: 'not-captured', status: 'needs-pose', ms: 1 }, { render: 'simulated', pose: pose(a, 's9', [3, 0], { shape: 'mismatch' }) }),
      step('s10', { outcome: 'not-captured', status: 'needs-pose', ms: 1 }, { render: 'simulated', pose: pose(a, 's10', [0, 0]) }),
    ]);
    const after = results('after', [
      // The same.
      step('s1', captured(b, 's1', scene(line('valley', 1), line('aux', 2)))),
      // The same items, drawn in another order.
      step('s2', captured(b, 's2', scene(line('aux', 2), line('valley', 1)))),
      // Its status changed.
      step('s3', captured(b, 's3', scene(line('valley', 1))), { status: { link: 'stale', refresh: 'refresh', lightingChanged: false, readSha256: 'read' } }),
      // A new problem from the 3D window check.
      step('s4', captured(b, 's4', scene(line('valley', 1))), { render: 'folded-3d', window: window(40) }),
      // The same probe problem on both sides.
      step('s5', captured(b, 's5', scene(line('valley', 1))), { probe: { outcome: 'checked', captureChanged: true, statusAfter: 'current', problem: 'still reads current' } }),
      // Moved by one snap step: rounding, not listed.
      step('s6', captured(b, 's6', scene(line('valley', 1.01)))),
      // Over the time limit on one side: not compared.
      step('s7', captured(b, 's7', scene(line('valley', 9)))),
      // Needs Pose on both sides: not compared, though its Pose view is, and it drew stubs.
      step('s8', { outcome: 'not-captured', status: 'needs-pose', ms: 1 }, { render: 'simulated', pose: pose(b, 's8', [0, 500]) }),
      // A saved shape Pose cannot put back, on both sides.
      step('s9', { outcome: 'not-captured', status: 'needs-pose', ms: 1 }, { render: 'simulated', pose: pose(b, 's9', [3, 0], { shape: 'mismatch' }) }),
      // The replay refused this side's shaders: the live view is not compared, which is not a change.
      step('s10', { outcome: 'not-captured', status: 'needs-pose', ms: 1 }, {
        render: 'simulated',
        pose: pose(b, 's10', [0, 900], { liveRefused: 'its edge shader declares faceDepth, which the replay does not read' }),
      }),
    ]);

    const model = diffResults(before, after, { before: beforeDir, after: afterDir });

    expect(model.steps).toBe(10);
    expect(model.changedSteps.map((change) => [change.id, change.reasons])).toEqual([
      ['s2', ['Draw order changed: the same lines and faces, drawn in another order']],
      ['s3', ['Status: current → stale', 'Refresh: not needed → refresh']],
      ['s4', ['New problem: 3D window check: 40 px of aux lines drawn over the paper that covers them (1 line)']],
      ['s8', ['Pose view: ink over paper not its own: aux 0 → 500 px (1 of 2 cameras)']],
    ]);
    expect(model.changedSteps.find((change) => change.id === 's8')?.pictures).toEqual({
      kind: 'image',
      before: 's8/pose-1-live.png',
      after: 's8/pose-1-live.png',
      label: 'ring 1, the live view',
    });
    expect(model.rounding).toBe(1);
    expect(model.notCompared).toEqual({ 'over 10 s, timing-sensitive': 1, 'Simulated above 0%, which needs Pose': 3 });
    expect(model.pose).toEqual({
      steps: 3,
      cameras: 2,
      notReplayed: { 'after: its edge shader declares faceDepth, which the replay does not read': 1 },
    });
    expect(model.alreadyBroken).toEqual([
      { slug: 'case', step: { id: 's5', number: 5 }, problem: 'Aux probe: still reads current' },
      {
        slug: 'case',
        step: { id: 's9', number: 9 },
        problem: "Pose cannot put its saved shape back (it is another sheet's): it folds the step from flat, unsaid",
      },
    ]);
    expect(summaryLine(model)).toBe(
      'diagram corpus: 4 of 10 steps changed; 6 re-captured, 4 not; ' +
        '3 Pose views at 2 cameras each (1 not replayed live: shaders the replay does not read); 2 problems already broken before'
    );

    const out = tempDir();
    const page = readFileSync(writeReport(model, { before: beforeDir, after: afterDir }, out), 'utf8');
    expect(page).toContain('Already broken before');
    // Both captures of a changed step painted on one projection: the same frame.
    const frameOf = (side: string) =>
      /viewBox="([^"]+)"/.exec(readFileSync(join(out, 'pictures', `case--s2--${side}.svg`), 'utf8'))?.[1];
    expect(frameOf('before')).toBeDefined();
    expect(frameOf('after')).toBe(frameOf('before'));
    // A Pose change shows both sides' frames at the camera that changed.
    expect(page).toContain('pictures/case--s8--after.png');
    expect(readFileSync(join(out, 'pictures', 'case--s8--after.png'))).toEqual(Buffer.from([1]));
  });
});

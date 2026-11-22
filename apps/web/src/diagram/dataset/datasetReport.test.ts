import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaperLineItem, PaperScene } from '@treemaker/origami-simulator';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { diffResults, summaryLine, writeReport } from './datasetReport';
import {
  RESULTS_FORMAT,
  RESULTS_VERSION,
  ResultsWriter,
  type CaptureRecord,
  type DatasetResults,
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
    ]);

    const model = diffResults(before, after, { before: beforeDir, after: afterDir });

    expect(model.steps).toBe(7);
    expect(model.changedSteps.map((change) => [change.id, change.reasons])).toEqual([
      ['s2', ['Draw order changed: the same lines and faces, drawn in another order']],
      ['s3', ['Status: current → stale', 'Refresh: not needed → refresh']],
      ['s4', ['New problem: 3D window check: 40 px of aux lines drawn over the paper that covers them (1 line)']],
    ]);
    expect(model.rounding).toBe(1);
    expect(model.notCompared).toEqual({ 'over 10 s, timing-sensitive': 1 });
    expect(model.alreadyBroken).toEqual([{ slug: 'case', step: { id: 's5', number: 5 }, problem: 'Aux probe: still reads current' }]);
    expect(summaryLine(model)).toBe('diagram corpus: 3 of 7 steps changed; 1 problems already broken before');

    const out = tempDir();
    const page = readFileSync(writeReport(model, { before: beforeDir, after: afterDir }, out), 'utf8');
    expect(page).toContain('Already broken before');
    // Both captures of a changed step painted on one projection: the same frame.
    const frameOf = (side: string) =>
      /viewBox="([^"]+)"/.exec(readFileSync(join(out, 'pictures', `case--s2--${side}.svg`), 'utf8'))?.[1];
    expect(frameOf('before')).toBeDefined();
    expect(frameOf('after')).toBe(frameOf('before'));
  });
});

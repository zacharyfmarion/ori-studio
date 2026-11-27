/**
 * What one side of a diagram corpus run writes, and how. Test-only.
 *
 * A run writes `results.json` and, beside it, every picture it painted as a
 * gzipped SVG and every scene it captured as gzipped JSON, so the report can
 * show any changed step without running again. Nothing is compared here: a
 * side records, and the report compares two sides
 * (`diagramDatasetReport.test.ts`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { PaperLineRole } from '@treemaker/origami-simulator';

export const RESULTS_FORMAT = 'ori-diagram-corpus-results';
/** Raised when a field is added, removed or changes meaning, so a saved "before" from another version is not compared. */
export const RESULTS_VERSION = 1;

export interface DatasetResults {
  format: typeof RESULTS_FORMAT;
  version: number;
  /** What the runner says this side is: `before <sha>` or `after <sha> + working copy`. */
  label: string;
  node: string;
  /** The sha256 of each wasm bridge this side ran, by name. */
  bridges: Record<string, string>;
  startedAt: string;
  finishedAt: string;
  corpus: { dir: string; manifestSha256: string };
  skippedCases: { slug: string; reason: string }[];
  cases: CaseResult[];
}

export interface CaseResult {
  slug: string;
  sha256: string;
  /** `failed`: the case could not be opened or checked at all; `error` says why. */
  outcome: 'ran' | 'failed';
  error?: string;
  loadMs: number;
  totalMs: number;
  /** The diagram's style as read, for the report to paint both sides' captures alike. */
  style: unknown;
  file: FileRecord | null;
  steps: StepResult[];
}

/** The file check: what reading and saving the file did, and the problems it found on its own. */
export interface FileRecord {
  readOnly: boolean;
  /** Steps that read locked (a newer build's), by id. */
  locked: string[];
  /** Every asset the file holds: what the read made of it, and whether a save keeps it. */
  assets: { id: string; kind: string; fate: 'kept' | 'carried' | 'changed' | 'dropped'; saved: boolean; bytes: number; sha256: string }[];
  scenes: { checked: number; badKeys: string[]; unreadable: string[]; notCanonical: string[]; changedOnRead: string[] };
  /** What the first save of the untouched file writes for its documents; `file` is it, gzipped. */
  firstSave: { sha256: string; bytes: number; file: string };
  /** Saving again what the first save wrote changes nothing. */
  fixedPoint: boolean;
  /** The reader version the save writes, and the least the content needs. */
  reader: { written: number; needed: number };
  /** Problems the check finds without a comparison. */
  problems: string[];
}

export interface StepResult {
  id: string;
  /** Position among the diagram's steps, from 1, for showing; steps are matched by id. */
  number: number;
  /** `cp`, `fold-step`, `references-step`, `upload`, or `locked`. */
  source: string;
  render: string | null;
  spread: string | null;
  storedKey: string | null;
  /** The stored picture as Export picture writes it, and an enlarged step's window. */
  repaint: RepaintRecord | { error: string };
  status: StatusRecord | null;
  capture: CaptureRecord;
  /** Null for a step that does not fold in 3D unspread; `error` when the check itself failed. */
  window: WindowRecord | { error: string } | null;
  probe: ProbeRecord | null;
}

export interface PictureRecord {
  /** Relative to the side's folder; gzipped. */
  svg: string;
  sha256: string;
}

export interface RepaintRecord {
  /** Null for a step with no picture this build can draw. */
  picture: PictureRecord | null;
  zoomed: PictureRecord | null;
}

export interface StatusRecord {
  link: string;
  refresh: string | null;
  lightingChanged: boolean;
  /** A digest of what the reader made of the step's paper faces, marks and zoom area. */
  readSha256: string;
}

export type CaptureRecord =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'not-captured'; status: string; detail?: string; ms: number }
  | { outcome: 'threw'; error: string; ms: number }
  | { outcome: 'over-budget'; spreadFailed: boolean; ms: number }
  | {
      outcome: 'captured';
      key: string;
      paperFacesSha256: string;
      /** The new source's fingerprint, thumbnail, scope and render, as Refresh would store them. */
      sourceSha256: string;
      fingerprint: string;
      orderFreeSha256: string;
      counts: Record<string, number>;
      spreadFailed: boolean;
      noLayerOrder: boolean;
      ms: number;
      /** Over the app's time limits (10 s here): not compared exactly. */
      timingSensitive: boolean;
      /** The stored scene JSON, gzipped, relative to the side's folder. */
      scene: string;
    };

/** The 3D window check on an unspread 3D step, with its own aux lines and camera. */
export interface WindowRecord {
  painted: number;
  paper: number;
  missingInk: number;
  strayInk: Partial<Record<PaperLineRole, number>>;
  strayLines: Partial<Record<PaperLineRole, number>>;
}

/** The aux edit probe on a step's sheet. */
export type ProbeRecord =
  | { outcome: 'skipped'; reason: string }
  | {
      outcome: 'checked';
      /** The capture after the aux line differs from the one before it. */
      captureChanged: boolean;
      statusAfter: string;
      /** Set when the status does not follow the capture: the rule bug 2 broke. */
      problem: string | null;
    };

/** Writes a side's files under one folder. */
export class ResultsWriter {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Writes `text` gzipped at `relative` (without `.gz`), returning the path written, relative. */
  writeGz(relative: string, text: string): string {
    const path = `${relative}.gz`;
    const absolute = join(this.dir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, gzipSync(Buffer.from(text, 'utf8')));
    return path;
  }

  writeResults(results: DatasetResults): void {
    writeFileSync(join(this.dir, 'results.json'), `${JSON.stringify(results, null, 1)}\n`);
  }
}

export function readResults(dir: string): DatasetResults {
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')) as DatasetResults;
  if (results.format !== RESULTS_FORMAT) throw new Error(`${dir} holds no diagram corpus results`);
  if (results.version !== RESULTS_VERSION) {
    throw new Error(`${dir} holds results version ${results.version}; this harness writes ${RESULTS_VERSION}. Run that side again.`);
  }
  return results;
}

export function readGz(dir: string, relative: string): string {
  return gunzipSync(readFileSync(join(dir, relative))).toString('utf8');
}

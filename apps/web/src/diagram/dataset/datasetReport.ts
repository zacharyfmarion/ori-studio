/**
 * The diagram corpus report: what changed between two sides of a run, as one
 * local page. Test-only.
 *
 * Only steps that changed are listed, each with one plain line per reason and
 * its before and after pictures side by side at one scale and framing, with
 * nothing drawn on top (Zach: "visually i should be able to tell and
 * highlights often mask what actually moved"). Problems a check finds on both
 * sides are not changes: they go last, under "already broken before".
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PaperScene } from '@treemaker/origami-simulator';
import type { DiagramStyle } from '../document/diagramDocument';
import { sideBySide } from './datasetPaint';
import { compareScenes } from './sceneCompare';
import {
  readGz,
  type CaptureRecord,
  type CaseResult,
  type DatasetResults,
  type PoseCameraRecord,
  type PoseRecord,
  type StepResult,
  type WindowRecord,
} from './datasetResults';

/**
 * What a changed step is shown by: its two captures, painted together by this
 * checkout's painter so they line up; or, when only painting changed, each
 * side's own repaint of the stored picture; or, when only its Pose view
 * changed, both sides' frames (PNGs) at the camera that changed most.
 */
export type ReportPictures =
  | { kind: 'capture'; before: string | null; after: string | null }
  | { kind: 'repaint'; before: string | null; after: string | null }
  | { kind: 'image'; before: string | null; after: string | null; label: string };

export interface ReportStep {
  slug: string;
  id: string;
  number: number;
  render: string | null;
  reasons: string[];
  /** Files in each side's folder; null when neither side has a picture to show. */
  pictures: ReportPictures | null;
}

export interface ReportProblem {
  slug: string;
  /** Null for a problem with the file rather than a step. */
  step: { id: string; number: number } | null;
  problem: string;
}

export interface ReportModel {
  before: string;
  after: string;
  /** Bridges the two sides ran that differ, by name. */
  bridges: { name: string; before: string; after: string }[];
  files: number;
  steps: number;
  /** Steps not compared, by why. */
  notCompared: Record<string, number>;
  /**
   * Steps whose Pose view ran on both sides, and the most cameras one was
   * checked at; and of those, the ones whose live view was not compared, by
   * the reason the replay refused it.
   */
  pose: { steps: number; cameras: number; notReplayed: Record<string, number> };
  /** Steps whose 3D window check was not compared, by the reason the replay refused one side's window. */
  window: { notReplayed: Record<string, number> };
  /** Steps whose capture moved by no more than rounding: not listed. */
  rounding: number;
  changedSteps: ReportStep[];
  /** Changes to a file as a whole: its read, its save, a problem with it. */
  fileChanges: { slug: string; reasons: string[] }[];
  alreadyBroken: ReportProblem[];
  /** Cases on one side only, or failed on one side. */
  caseChanges: { slug: string; reason: string }[];
  /** Each case's style as the after side read it, to paint both sides' captures with. */
  styles: Record<string, unknown>;
}

/**
 * One line for the PR: how many steps changed, never which file, and how
 * many were not captured again — a step whose capture was not compared is
 * not one that stayed the same — and how many Pose views were checked.
 */
export function summaryLine(model: ReportModel): string {
  const changed = model.changedSteps.length;
  const files = model.fileChanges.length + model.caseChanges.length;
  const notCompared = Object.values(model.notCompared).reduce((sum, count) => sum + count, 0);
  const parts = [
    `diagram corpus: ${changed} of ${model.steps} steps changed`,
    `${model.steps - notCompared} re-captured, ${notCompared} not`,
  ];
  if (model.pose.steps > 0) {
    const notReplayed = Object.values(model.pose.notReplayed).reduce((sum, count) => sum + count, 0);
    parts.push(
      `${model.pose.steps} Pose views at ${model.pose.cameras} cameras each` +
        (notReplayed > 0 ? ` (${notReplayed} not replayed live: shaders the replay does not read)` : '')
    );
  }
  const windowsNotReplayed = Object.values(model.window.notReplayed).reduce((sum, count) => sum + count, 0);
  if (windowsNotReplayed > 0) {
    parts.push(`3D window check not replayed on ${plural(windowsNotReplayed, 'step')}: shaders the replay does not read`);
  }
  if (files > 0) parts.push(`${files} file-level change${files === 1 ? '' : 's'}`);
  if (model.alreadyBroken.length > 0) parts.push(`${model.alreadyBroken.length} problems already broken before`);
  return parts.join('; ');
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function sceneOf(dir: string, record: Extract<CaptureRecord, { outcome: 'captured' }>): PaperScene {
  return JSON.parse(readGz(dir, record.scene)) as PaperScene;
}

function describeCounts(before: Record<string, number>, after: Record<string, number>): string {
  const labels = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const names: Record<string, string> = {
    'face:front': 'front faces',
    'face:back': 'back faces',
    'line:aux': 'aux lines',
    'line:edge': 'edge lines',
    'line:mountain': 'mountain lines',
    'line:valley': 'valley lines',
  };
  return labels
    .filter((label) => (before[label] ?? 0) !== (after[label] ?? 0))
    .map((label) => `${names[label] ?? label} ${before[label] ?? 0} → ${after[label] ?? 0}`)
    .join(', ');
}

function captureLabel(record: CaptureRecord): string {
  switch (record.outcome) {
    case 'captured':
      return record.spreadFailed ? 'captured (spread failed)' : 'captured';
    case 'over-budget':
      return record.spreadFailed ? 'too detailed to keep as vector (spread failed)' : 'too detailed to keep as vector';
    case 'not-captured':
      return record.detail ? `${record.status} (${record.detail})` : record.status;
    case 'threw':
      return `failed: ${record.error}`;
    case 'skipped':
      return `skipped (${record.reason})`;
  }
}

/** What changed in a step's capture, in plain lines; `rounding` when only rounding did. */
function captureReasons(
  before: CaptureRecord,
  after: CaptureRecord,
  dirs: { before: string; after: string }
): string[] | 'rounding' {
  if (before.outcome !== after.outcome) return [`Capture: ${captureLabel(before)} → ${captureLabel(after)}`];
  if (before.outcome !== 'captured' || after.outcome !== 'captured') {
    const a = captureLabel(before);
    const b = captureLabel(after);
    return a === b ? [] : [`Capture: ${a} → ${b}`];
  }
  const reasons: string[] = [];
  if (before.key !== after.key) {
    const change = compareScenes(sceneOf(dirs.before, before), sceneOf(dirs.after, after));
    switch (change.kind) {
      case 'same':
        break;
      case 'rounding':
        if (before.paperFacesSha256 === after.paperFacesSha256 && before.sourceSha256 === after.sourceSha256) return 'rounding';
        break;
      case 'order':
        reasons.push('Draw order changed: the same lines and faces, drawn in another order');
        break;
      case 'items':
        reasons.push(`Picture changed: ${describeCounts(change.before, change.after)}`);
        break;
      case 'geometry':
        reasons.push(`Picture changed: ${plural(change.unmatched, 'item')} moved or changed`);
        break;
    }
  }
  if (before.spreadFailed !== after.spreadFailed) {
    reasons.push(after.spreadFailed ? 'Its spread now fails, so it is drawn unspread' : 'Its spread no longer fails');
  }
  if (before.paperFacesSha256 !== after.paperFacesSha256) reasons.push('Paper faces changed (x-ray, zoom and mark carry read them)');
  if (before.fingerprint !== after.fingerprint) {
    reasons.push(`Link fingerprint changed: ${before.fingerprint} → ${after.fingerprint}`);
  } else if (before.sourceSha256 !== after.sourceSha256) {
    reasons.push('The link Refresh would store changed (thumbnail, scope or render)');
  }
  return reasons;
}

/** The window check's counts; null when it did not run, failed, or the replay refused the window. */
const windowCounts = (record: StepResult['window']): WindowRecord | null =>
  record && !('error' in record) && !('refused' in record) ? record : null;
const AUX_PROBLEM = (record: WindowRecord) => record.strayInk.aux ?? 0;
const OTHER_STRAY = (record: WindowRecord) =>
  Object.entries(record.strayInk).reduce((total, [role, px]) => (role === 'aux' ? total : total + (px ?? 0)), 0);

function windowProblem(record: WindowRecord): string {
  const lines = record.strayLines.aux ?? 0;
  return `3D window check: ${AUX_PROBLEM(record)} px of aux lines drawn over the paper that covers them (${plural(lines, 'line')})`;
}

/* ------------------------------------------------------------------------
 * Pose views
 * --------------------------------------------------------------------- */

const ROLE_NAMES: Record<string, string> = { aux: 'aux', edge: 'edge', mountain: 'mountain fold', valley: 'valley fold' };
const FRAME_NAMES: Record<PoseRecord['frame'], string> = {
  folded: 'its 3D fold',
  'saved-shape': 'the shape it saved',
  're-solved': 'a re-solve from flat',
};
const SHAPE_NAMES: Record<NonNullable<PoseRecord['shape']>, string> = {
  none: 'none',
  restored: 'put back',
  mismatch: "another sheet's, which Pose cannot put back",
};
const SHAPE_PROBLEM = "Pose cannot put its saved shape back (it is another sheet's): it folds the step from flat, unsaid";

/** What each count is called in a reason, by measure. */
const POSE_MEASURES = [
  { measure: 'foreign', name: 'ink over paper not its own', unit: ' px' },
  { measure: 'gaps', name: 'points where a line is missing over its own paper', unit: '' },
] as const;

/** Aux lines first: the lines a buried layer pokes through with. */
const ROLE_ORDER = ['aux', 'edge', 'mountain', 'valley'];
const byRoleOrder = (a: string, b: string) =>
  (ROLE_ORDER.indexOf(a) + 1 || ROLE_ORDER.length + 1) - (ROLE_ORDER.indexOf(b) + 1 || ROLE_ORDER.length + 1) || a.localeCompare(b);

const POSE_PARTS = [
  { part: 'live', name: 'Pose view' },
  { part: 'picture', name: 'Pose picture' },
] as const;

function poseOutcome(record: StepResult['pose'] | undefined): string {
  if (!record) return 'none';
  if ('error' in record) return `failed: ${record.error}`;
  if ('skipped' in record) return `skipped (${record.skipped})`;
  return 'ran';
}

type PoseCounts = Partial<Record<string, number>>;

function countsOf(camera: PoseCameraRecord, part: 'live' | 'picture', measure: 'foreign' | 'gaps'): PoseCounts {
  const record = camera[part];
  return !record || 'error' in record ? {} : record[measure];
}

interface PoseDiff {
  reasons: string[];
  broken: string[];
  picture: Extract<ReportPictures, { kind: 'image' }> | null;
  /** Ran on both sides, and the most cameras either side checked. */
  ran: boolean;
  cameras: number;
  /** Why the live views were not compared: a side the replay refused, and why. */
  liveNotReplayed: string | null;
}

/**
 * What changed in a step's Pose view: how its frames were made, the live
 * view's depth state as its draws set it, and every count, summed over the
 * cameras both sides checked. A shape Pose cannot put back is a problem on
 * its own; everything else is held to the other side.
 */
function diffPose(before: StepResult['pose'] | undefined, after: StepResult['pose'] | undefined): PoseDiff {
  const diff: PoseDiff = { reasons: [], broken: [], picture: null, ran: false, cameras: 0, liveNotReplayed: null };
  const was = poseOutcome(before);
  const is = poseOutcome(after);
  if (was !== 'ran' || is !== 'ran') {
    if (was === is) {
      if (was.startsWith('failed')) diff.broken.push(`Pose check ${was}`);
    } else diff.reasons.push(`Pose check: ${was} → ${is}`);
    return diff;
  }
  const x = before as PoseRecord;
  const y = after as PoseRecord;
  diff.ran = true;
  diff.cameras = Math.max(x.cameras.length, y.cameras.length);
  if (x.frame !== y.frame) diff.reasons.push(`Pose view drawn from ${FRAME_NAMES[x.frame]} → ${FRAME_NAMES[y.frame]}`);
  if (x.shape === 'mismatch' && y.shape === 'mismatch') diff.broken.push(SHAPE_PROBLEM);
  else if (x.shape !== y.shape) {
    diff.reasons.push(`Its saved shape: ${SHAPE_NAMES[x.shape ?? 'none']} → ${SHAPE_NAMES[y.shape ?? 'none']}`);
  }
  if (x.solve && y.solve && x.solve.settled !== y.solve.settled) {
    diff.reasons.push(`The re-solve ${y.solve.settled ? 'now settles' : 'no longer settles'} within its steps`);
  }
  // A side the replay refused has no live counts: its live view is not compared, for the reason it gave.
  if (x.liveRefused !== undefined || y.liveRefused !== undefined) {
    diff.liveNotReplayed = y.liveRefused !== undefined ? `after: ${y.liveRefused}` : `before: ${x.liveRefused}`;
  } else {
    const list = (values: readonly unknown[]) => values.map(String).join(' and ') || 'none';
    const draws: Array<[string, readonly unknown[], readonly unknown[]]> = [
      ['depth is perspective', x.draws.perspective, y.draws.perspective],
      ['crease depth bias', x.draws.creaseBias, y.draws.creaseBias],
      ['creases write depth', x.draws.creaseWritesDepth, y.draws.creaseWritesDepth],
    ];
    for (const [name, a, b] of draws) {
      if (list(a) !== list(b)) diff.reasons.push(`The live view's draws: ${name} ${list(a)} → ${list(b)}`);
    }
  }

  const afterByName = new Map(y.cameras.map((camera) => [camera.name, camera]));
  const pairs = x.cameras.flatMap((camera) => {
    const other = afterByName.get(camera.name);
    return other ? [[camera, other] as const] : [];
  });
  let most: { delta: number; label: string; before: string | null; after: string | null } | null = null;
  for (const { part, name: partName } of POSE_PARTS) {
    if (part === 'live' && diff.liveNotReplayed !== null) continue;
    for (const { measure, name, unit } of POSE_MEASURES) {
      const roles = new Set(pairs.flatMap(([a, b]) => [...Object.keys(countsOf(a, part, measure)), ...Object.keys(countsOf(b, part, measure))]));
      const changes: string[] = [];
      for (const role of [...roles].sort(byRoleOrder)) {
        let was = 0;
        let is = 0;
        for (const [a, b] of pairs) {
          was += countsOf(a, part, measure)[role] ?? 0;
          is += countsOf(b, part, measure)[role] ?? 0;
        }
        if (was === is) continue;
        changes.push(`${ROLE_NAMES[role] ?? role} ${was.toLocaleString('en')} → ${is.toLocaleString('en')}${unit}`);
      }
      const differing = pairs.filter(([a, b]) => {
        const ca = countsOf(a, part, measure);
        const cb = countsOf(b, part, measure);
        return [...new Set([...Object.keys(ca), ...Object.keys(cb)])].some((role) => (ca[role] ?? 0) !== (cb[role] ?? 0));
      }).length;
      if (changes.length > 0) diff.reasons.push(`${partName}: ${name}: ${changes.join(', ')} (${differing} of ${pairs.length} cameras)`);
    }
    for (const [a, b] of pairs) {
      let delta = 0;
      for (const { measure } of POSE_MEASURES) {
        const ca = countsOf(a, part, measure);
        const cb = countsOf(b, part, measure);
        for (const role of new Set([...Object.keys(ca), ...Object.keys(cb)])) delta += Math.abs((cb[role] ?? 0) - (ca[role] ?? 0));
      }
      if (delta > (most?.delta ?? 0)) {
        most = {
          delta,
          label: `${a.name}, ${part === 'live' ? 'the live view' : 'the picture leaving Pose saves'}`,
          before: part === 'live' ? a.liveImage : a.pictureImage,
          after: part === 'live' ? b.liveImage : b.pictureImage,
        };
      }
    }
  }
  if (most) diff.picture = { kind: 'image', before: most.before, after: most.after, label: most.label };
  else if (diff.reasons.length > 0 && pairs[0] && pairs[0][0].liveImage && pairs[0][1].liveImage) {
    diff.picture = { kind: 'image', before: pairs[0][0].liveImage, after: pairs[0][1].liveImage, label: `${pairs[0][0].name}, the live view` };
  }
  return diff;
}

interface StepDiff {
  reasons: string[];
  rounding: boolean;
  notCompared: string | null;
  broken: string[];
  /** Which pictures say the most: the captures when they changed, else the repaints, else the Pose frames. */
  show: 'capture' | 'repaint' | 'pose';
  pose: PoseDiff;
  /** Why the 3D window check was not compared: a side whose window the replay refused, and why. */
  windowNotReplayed: string | null;
}

/**
 * Why neither side's capture says anything: both asked for Pose, which the
 * harness does not run as a capture (`captureStep` answers `needs-pose` for a
 * Simulated step above 0% and for a Defox render). Equal outcomes, but not a
 * comparison of anything, so the step is not compared rather than unchanged.
 * Null when either side captured, or answered anything else.
 */
function needsPoseOnBothSides(before: StepResult, after: StepResult): string | null {
  const needsPose = (side: StepResult) => side.capture.outcome === 'not-captured' && side.capture.status === 'needs-pose';
  if (!needsPose(before) || !needsPose(after)) return null;
  return (after.render ?? before.render) === 'defox'
    ? 'a Defox render, which needs Pose'
    : 'Simulated above 0%, which needs Pose';
}

function diffStep(before: StepResult, after: StepResult, dirs: { before: string; after: string }): StepDiff {
  const reasons: string[] = [];
  const broken: string[] = [];
  let rounding = false;
  let notCompared: string | null = null;
  let show: StepDiff['show'] = 'repaint';

  const timing =
    (before.capture.outcome === 'captured' && before.capture.timingSensitive) ||
    (after.capture.outcome === 'captured' && after.capture.timingSensitive);
  const needsPose = needsPoseOnBothSides(before, after);
  if (timing) notCompared = 'over 10 s, timing-sensitive';
  else if (before.capture.outcome === 'skipped' && after.capture.outcome === 'skipped') notCompared = before.capture.reason;
  else if (needsPose) notCompared = needsPose;
  else {
    const capture = captureReasons(before.capture, after.capture, dirs);
    if (capture === 'rounding') rounding = true;
    else if (capture.length > 0) {
      reasons.push(...capture);
      show = 'capture';
    }
  }

  const failed = (record: StepResult['repaint']) => ('error' in record ? record.error : null);
  const errorBefore = failed(before.repaint);
  const errorAfter = failed(after.repaint);
  if (errorBefore || errorAfter) {
    if (errorBefore !== errorAfter) reasons.push(`Repainting the stored picture: ${errorBefore ?? 'painted'} → ${errorAfter ?? 'painted'}`);
  } else if ('picture' in before.repaint && 'picture' in after.repaint) {
    if ((before.repaint.picture?.sha256 ?? null) !== (after.repaint.picture?.sha256 ?? null)) {
      reasons.push(
        !before.repaint.picture || !after.repaint.picture
          ? `The stored picture ${after.repaint.picture ? 'now paints' : 'no longer paints'}`
          : 'The stored picture paints differently'
      );
    }
    if ((before.repaint.zoomed?.sha256 ?? null) !== (after.repaint.zoomed?.sha256 ?? null)) {
      reasons.push('The enlarged window paints differently');
    }
  }

  if (before.status && after.status) {
    if (before.status.link !== after.status.link) reasons.push(`Status: ${before.status.link} → ${after.status.link}`);
    if (before.status.refresh !== after.status.refresh) {
      reasons.push(`Refresh: ${before.status.refresh ?? 'not needed'} → ${after.status.refresh ?? 'not needed'}`);
    }
    if (before.status.lightingChanged !== after.status.lightingChanged) {
      reasons.push(after.status.lightingChanged ? 'Now reads as lit by another style' : 'No longer reads as lit by another style');
    }
    if (before.status.readSha256 !== after.status.readSha256) reasons.push('The file now reads its paper faces, marks or zoom area differently');
  }

  const windowError = (record: StepResult['window']) => (record && 'error' in record ? record.error : null);
  const windowRefused = (record: StepResult['window']) => (record && 'refused' in record ? record.refused : null);
  let windowNotReplayed: string | null = null;
  if (windowRefused(before.window) !== null || windowRefused(after.window) !== null) {
    // A side whose window the replay refused has no counts: the check is not compared, for the reason it gave.
    const refusedAfter = windowRefused(after.window);
    windowNotReplayed = refusedAfter !== null ? `after: ${refusedAfter}` : `before: ${windowRefused(before.window)}`;
  } else if (windowError(before.window) || windowError(after.window)) {
    if (windowError(before.window) !== windowError(after.window)) {
      reasons.push(`3D window check: ${windowError(before.window) ?? 'ran'} → ${windowError(after.window) ?? 'ran'}`);
    }
  } else if (before.window || after.window) {
    const was = windowCounts(before.window);
    const is = windowCounts(after.window);
    if (!was || !is) {
      reasons.push(`3D window check ran ${before.window ? 'before only' : 'after only'}`);
    } else {
      const wasAux = AUX_PROBLEM(was) > 0;
      const isAux = AUX_PROBLEM(is) > 0;
      if (isAux && wasAux) broken.push(windowProblem(is));
      else if (isAux) reasons.push(`New problem: ${windowProblem(is)}`);
      else if (wasAux) reasons.push(`Fixed: ${windowProblem(was)}`);
      const more = OTHER_STRAY(is) - OTHER_STRAY(was);
      if (more > 0) reasons.push(`3D window check: ${more} px more fold or edge ink over bare paper than before`);
      if (is.missingInk > was.missingInk) {
        reasons.push(`3D window check: ${is.missingInk - was.missingInk} px more window ink the picture leaves out`);
      }
    }
  }

  const probeProblem = (record: StepResult['probe']) => (record?.outcome === 'checked' ? record.problem : null);
  const wasProbe = probeProblem(before.probe);
  const isProbe = probeProblem(after.probe);
  if (isProbe && wasProbe) broken.push(`Aux probe: ${isProbe}`);
  else if (isProbe) reasons.push(`New problem: aux probe: ${isProbe}`);
  else if (wasProbe) reasons.push(`Fixed: aux probe: ${wasProbe}`);

  const pose = diffPose(before.pose, after.pose);
  if (reasons.length === 0 && pose.picture) show = 'pose';
  reasons.push(...pose.reasons);
  broken.push(...pose.broken);

  return { reasons, rounding, notCompared, broken, show, pose, windowNotReplayed };
}

function diffFile(before: CaseResult, after: CaseResult): { reasons: string[]; broken: string[] } {
  const reasons: string[] = [];
  const broken: string[] = [];
  const a = before.file;
  const b = after.file;
  if (!a || !b) {
    if (a !== b) reasons.push(`The file check ran ${a ? 'before only' : 'after only'}`);
    return { reasons, broken };
  }
  if (a.readOnly !== b.readOnly) reasons.push(b.readOnly ? 'Now opens read-only' : 'No longer opens read-only');
  const locked = (ids: string[]) => (ids.length > 0 ? ids.join(', ') : 'none');
  if (locked(a.locked) !== locked(b.locked)) reasons.push(`Locked steps: ${locked(a.locked)} → ${locked(b.locked)}`);
  const assets = (file: typeof a) => JSON.stringify(file.assets);
  if (assets(a) !== assets(b)) reasons.push(`Assets read differently: ${a.assets.length} → ${b.assets.length}`);
  if (a.firstSave.sha256 !== b.firstSave.sha256) {
    reasons.push(`The first save writes something different (${a.firstSave.bytes} → ${b.firstSave.bytes} bytes)`);
  }
  if (a.fixedPoint !== b.fixedPoint) reasons.push(b.fixedPoint ? 'A second save now changes nothing' : 'A second save now changes the file again');
  if (a.reader.written !== b.reader.written || a.reader.needed !== b.reader.needed) {
    reasons.push(`Reader version written ${a.reader.written} → ${b.reader.written} (needed ${a.reader.needed} → ${b.reader.needed})`);
  }
  for (const problem of b.problems) {
    if (a.problems.includes(problem)) broken.push(problem);
    else reasons.push(`New problem: ${problem}`);
  }
  for (const problem of a.problems) if (!b.problems.includes(problem)) reasons.push(`Fixed: ${problem}`);
  return { reasons, broken };
}

/** What a changed step is shown by: its Pose frames when only they changed, its captures when either side has one, else its repaints. */
function picturesFor(before: StepResult, after: StepResult, diff: StepDiff): ReportPictures | null {
  if (diff.show === 'pose' && diff.pose.picture) return diff.pose.picture;
  const scene = (side: StepResult) => (side.capture.outcome === 'captured' ? side.capture.scene : null);
  const repaint = (side: StepResult) => ('picture' in side.repaint ? (side.repaint.picture?.svg ?? null) : null);
  const captures = { kind: 'capture' as const, before: scene(before), after: scene(after) };
  const repaints = { kind: 'repaint' as const, before: repaint(before), after: repaint(after) };
  const has = (pictures: ReportPictures) => pictures.before !== null || pictures.after !== null;
  if (diff.show === 'repaint' && has(repaints)) return repaints;
  if (has(captures)) return captures;
  return has(repaints) ? repaints : null;
}

export function diffResults(before: DatasetResults, after: DatasetResults, dirs: { before: string; after: string }): ReportModel {
  const model: ReportModel = {
    before: before.label,
    after: after.label,
    bridges: Object.keys({ ...before.bridges, ...after.bridges })
      .filter((name) => before.bridges[name] !== after.bridges[name])
      .map((name) => ({ name, before: (before.bridges[name] ?? 'none').slice(0, 12), after: (after.bridges[name] ?? 'none').slice(0, 12) })),
    files: 0,
    steps: 0,
    notCompared: {},
    pose: { steps: 0, cameras: 0, notReplayed: {} },
    window: { notReplayed: {} },
    rounding: 0,
    changedSteps: [],
    fileChanges: [],
    alreadyBroken: [],
    caseChanges: [],
    styles: {},
  };
  const afterBySlug = new Map(after.cases.map((kase) => [kase.slug, kase]));
  for (const kase of before.cases) {
    const other = afterBySlug.get(kase.slug);
    afterBySlug.delete(kase.slug);
    if (!other) {
      model.caseChanges.push({ slug: kase.slug, reason: 'ran before only' });
      continue;
    }
    if (kase.sha256 !== other.sha256) {
      model.caseChanges.push({ slug: kase.slug, reason: 'the two sides read different copies of this file' });
      continue;
    }
    if (kase.outcome !== other.outcome) {
      model.caseChanges.push({
        slug: kase.slug,
        reason: other.outcome === 'failed' ? `now fails: ${other.error ?? 'unknown error'}` : `no longer fails (was: ${kase.error ?? 'unknown error'})`,
      });
      continue;
    }
    if (kase.outcome === 'failed') {
      model.alreadyBroken.push({ slug: kase.slug, step: null, problem: `The case fails: ${other.error ?? kase.error ?? 'unknown error'}` });
      continue;
    }
    model.files += 1;
    model.styles[kase.slug] = other.style;
    const file = diffFile(kase, other);
    if (file.reasons.length > 0) model.fileChanges.push({ slug: kase.slug, reasons: file.reasons });
    for (const problem of file.broken) model.alreadyBroken.push({ slug: kase.slug, step: null, problem });

    const afterSteps = new Map(other.steps.map((step) => [step.id, step]));
    for (const step of kase.steps) {
      const next = afterSteps.get(step.id);
      afterSteps.delete(step.id);
      model.steps += 1;
      if (!next) {
        model.changedSteps.push({ slug: kase.slug, id: step.id, number: step.number, render: step.render, reasons: ['Read before only'], pictures: null });
        continue;
      }
      const diff = diffStep(step, next, dirs);
      if (diff.notCompared) model.notCompared[diff.notCompared] = (model.notCompared[diff.notCompared] ?? 0) + 1;
      if (diff.rounding) model.rounding += 1;
      if (diff.pose.ran) {
        model.pose.steps += 1;
        model.pose.cameras = Math.max(model.pose.cameras, diff.pose.cameras);
        const refused = diff.pose.liveNotReplayed;
        if (refused !== null) model.pose.notReplayed[refused] = (model.pose.notReplayed[refused] ?? 0) + 1;
      }
      const windowRefused = diff.windowNotReplayed;
      if (windowRefused !== null) model.window.notReplayed[windowRefused] = (model.window.notReplayed[windowRefused] ?? 0) + 1;
      for (const problem of diff.broken) model.alreadyBroken.push({ slug: kase.slug, step: { id: step.id, number: step.number }, problem });
      if (diff.reasons.length === 0) continue;
      model.changedSteps.push({
        slug: kase.slug,
        id: step.id,
        number: step.number,
        render: next.render ?? step.render,
        reasons: diff.reasons,
        pictures: picturesFor(step, next, diff),
      });
    }
    for (const step of afterSteps.values()) {
      model.steps += 1;
      model.changedSteps.push({ slug: kase.slug, id: step.id, number: step.number, render: step.render, reasons: ['Read after only'], pictures: null });
    }
  }
  for (const kase of afterBySlug.values()) model.caseChanges.push({ slug: kase.slug, reason: 'ran after only' });
  return model;
}

/* ------------------------------------------------------------------------
 * The page
 * --------------------------------------------------------------------- */

type ViewBox = [number, number, number, number];

function viewBoxOf(svg: string): ViewBox | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const box = /\bviewBox="([^"]+)"/i.exec(root)?.[1];
  if (box) {
    const numbers = box.trim().split(/[\s,]+/).map(Number);
    if (numbers.length === 4 && numbers.every(Number.isFinite)) return numbers as ViewBox;
  }
  const width = Number(/\bwidth="([\d.]+)/i.exec(root)?.[1]);
  const height = Number(/\bheight="([\d.]+)/i.exec(root)?.[1]);
  return Number.isFinite(width) && Number.isFinite(height) ? [0, 0, width, height] : null;
}

/** The SVG at its own frame, sized by the page rather than by its own width and height. */
function fitted(svg: string, box: ViewBox | null): string {
  if (!box) return svg;
  return svg.replace(/<svg\b[^>]*>/i, (root) =>
    root
      .replace(/\s(width|height|viewBox|preserveAspectRatio)="[^"]*"/gi, '')
      .replace(/<svg\b/i, `<svg viewBox="${box.join(' ')}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%"`)
  );
}

/** The two SVGs a changed step shows: captures painted together, or each side's repaint as it is. */
function stepSvgs(step: ReportStep, model: ReportModel, dirs: { before: string; after: string }): [string | null, string | null] {
  const pictures = step.pictures;
  if (!pictures || pictures.kind === 'image') return [null, null];
  const read = (dir: string, path: string | null) => (path ? readGz(dir, path) : null);
  const before = read(dirs.before, pictures.before);
  const after = read(dirs.after, pictures.after);
  if (pictures.kind === 'repaint') return [before, after];
  const style = model.styles[step.slug] as DiagramStyle | undefined;
  return style ? sideBySide(before, after, style, step.render) : [null, null];
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

const STYLE = `
:root { --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --line: #e7e5e4; --panel: #ffffff; --radius: 8px; color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --line: #44403c; --panel: #ffffff; color-scheme: dark; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 40px 0 12px; padding-top: 12px; border-top: 1px solid var(--line); }
h3 { font-size: 15px; margin: 24px 0 6px; }
p, li { color: var(--muted); }
.summary p { margin: 4px 0; }
.summary strong { color: var(--fg); }
ul.reasons { margin: 4px 0 10px; padding-left: 20px; }
ul.reasons li { color: var(--fg); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
figure { margin: 0; }
figcaption { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
.frame { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.frame img { display: block; width: 100%; height: 100%; }
.none { display: grid; place-items: center; height: 120px; color: #78716c; font-size: 13px; }
code { font-size: 13px; }
`;

/** Writes the page and the pictures it shows into `outDir`; returns the page's path. */
export function writeReport(model: ReportModel, dirs: { before: string; after: string }, outDir: string): string {
  mkdirSync(join(outDir, 'pictures'), { recursive: true });
  const body: string[] = [];
  body.push(`<h1>Diagram corpus: before and after</h1>`);
  const notCompared = Object.entries(model.notCompared)
    .sort((a, b) => b[1] - a[1])
    .map(([why, count]) => `${count} ${why}`)
    .join('; ');
  body.push(`<div class="summary">
<p><strong>Before:</strong> ${escape(model.before)}</p>
<p><strong>After:</strong> ${escape(model.after)}</p>
${model.bridges.length > 0 ? `<p>Different wasm on each side: ${model.bridges.map((bridge) => `${escape(bridge.name)} ${bridge.before} → ${bridge.after}`).join('; ')}.</p>` : ''}
<p><strong>${model.changedSteps.length}</strong> of ${model.steps} steps in ${model.files} files changed.
${model.rounding > 0 ? ` ${plural(model.rounding, 'step')} moved by no more than rounding and are not listed.` : ''}</p>
${notCompared ? `<p>Not captured again, so not compared as captures (their files, repaints and statuses were): ${escape(notCompared)}.</p>` : ''}
${model.pose.steps > 0 ? `<p>Pose views checked on both sides: ${plural(model.pose.steps, 'step')}, at ${model.pose.cameras} cameras each (live and the picture leaving Pose saves).</p>` : ''}
${Object.entries(model.pose.notReplayed)
  .map(([why, count]) => `<p>Live views not compared, the pictures only: ${plural(count, 'step')}. The replay refused one side's shaders, ${escape(why)}.</p>`)
  .join('\n')}
${Object.entries(model.window.notReplayed)
  .map(([why, count]) => `<p>3D window checks not compared: ${plural(count, 'step')}. The replay refused one side's window, ${escape(why)}.</p>`)
  .join('\n')}
${model.alreadyBroken.length > 0 ? `<p>${plural(model.alreadyBroken.length, 'problem')} found on both sides, listed at the end.</p>` : ''}
</div>`);

  if (model.caseChanges.length > 0) {
    body.push(`<h2>Files that ran differently</h2><ul class="reasons">${model.caseChanges
      .map((change) => `<li><code>${escape(change.slug)}</code>: ${escape(change.reason)}</li>`)
      .join('')}</ul>`);
  }
  if (model.fileChanges.length > 0) {
    body.push(`<h2>Changes to whole files</h2>`);
    for (const change of model.fileChanges) {
      body.push(`<h3><code>${escape(change.slug)}</code></h3><ul class="reasons">${change.reasons.map((reason) => `<li>${escape(reason)}</li>`).join('')}</ul>`);
    }
  }

  const bySlug = new Map<string, ReportStep[]>();
  for (const step of model.changedSteps) {
    const list = bySlug.get(step.slug) ?? [];
    list.push(step);
    bySlug.set(step.slug, list);
  }
  for (const [slug, steps] of bySlug) {
    body.push(`<h2><code>${escape(slug)}</code>: ${plural(steps.length, 'step')} changed</h2>`);
    for (const step of steps) {
      const [beforeSvg, afterSvg] = stepSvgs(step, model, dirs);
      const svgs = { before: beforeSvg, after: afterSvg };
      const images = step.pictures?.kind === 'image' ? step.pictures : null;
      const panel = (side: 'before' | 'after') => {
        const svg = svgs[side];
        const caption = side === 'before' ? 'Before' : 'After';
        const image = images?.[side];
        if (image) {
          const name = `pictures/${slug}--${step.id}--${side}.png`;
          copyFileSync(join(dirs[side], image), join(outDir, name));
          return `<figure><figcaption>${caption}</figcaption><div class="frame" style="aspect-ratio: 1;"><img src="${escape(name)}" alt="${side}: ${escape(images.label)}" loading="lazy"></div></figure>`;
        }
        if (!svg) return `<figure><figcaption>${caption}</figcaption><div class="frame none">No picture</div></figure>`;
        const box = viewBoxOf(svg);
        const aspect = box ? `aspect-ratio: ${box[2]} / ${box[3]};` : 'aspect-ratio: 1;';
        const name = `pictures/${slug}--${step.id}--${side}.svg`;
        writeFileSync(join(outDir, name), fitted(svg, box));
        return `<figure><figcaption>${caption}</figcaption><div class="frame" style="${aspect}"><img src="${escape(name)}" alt="${side} picture of step ${step.number}" loading="lazy"></div></figure>`;
      };
      body.push(`<h3>Step ${step.number}${step.render ? ` (${escape(step.render)})` : ''} <code>${escape(step.id)}</code></h3>
<ul class="reasons">${step.reasons.map((reason) => `<li>${escape(reason)}</li>`).join('')}</ul>
${images ? `<p>Shown: ${escape(images.label)}, as the replay draws it (the paper by side, folds and edges dark, aux lines grey).</p>` : ''}
<div class="pair">${panel('before')}${panel('after')}</div>`);
    }
  }

  if (model.alreadyBroken.length > 0) {
    body.push(`<h2>Already broken before</h2><p>Problems a check finds on both sides. Not changes; listed so they stay in view.</p><ul class="reasons">${model.alreadyBroken
      .map(
        (entry) =>
          `<li><code>${escape(entry.slug)}</code>${entry.step ? ` step ${entry.step.number} <code>${escape(entry.step.id)}</code>` : ''}: ${escape(entry.problem)}</li>`
      )
      .join('')}</ul>`);
  }

  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagram corpus report</title><style>${STYLE}</style></head>
<body><main>${body.join('\n')}</main></body></html>
`;
  const path = join(outDir, 'index.html');
  writeFileSync(path, page);
  writeFileSync(join(outDir, 'summary.txt'), `${summaryLine(model)}\n`);
  return path;
}

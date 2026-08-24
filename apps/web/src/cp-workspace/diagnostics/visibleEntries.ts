import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import { isDiagnosticResultOperation } from './hudStatus';
import { sortedCpDiagnosticEntries } from './severity';

const NONE: readonly OristudioCpDiagnosticEntry[] = [];

/**
 * How close two points have to be to name the same vertex.
 *
 * The kernel's own answer: `checks_spatial::CELL`, which is Oriedita's
 * `Epsilon::UNKNOWN_1EN4` (0.01 × 1e-4). Every check that ships clusters
 * incidences at it, so two points inside it are not merely near each other —
 * they are one vertex to everything that produced them. Any looser number would
 * be this module inventing a second definition of "the same vertex"; any tighter
 * would reject points the kernel already merged.
 */
const SAME_VERTEX = 1e-6;

/**
 * The diagnostic entries currently on the canvas.
 *
 * Two results can contribute. The always-on CAMV overlay re-runs after every edit
 * and is what the "Foldability issues" toggle hides. A check or repair command
 * leaves its own findings in `lastCommandResult`, which are shown whether or not
 * the overlay is on — except for `CheckCamv` itself, whose findings *are* the
 * overlay and so follow the toggle.
 *
 * Returned as one list because everything downstream — markers, the HUD list,
 * what a jump-to-diagnostic can reach — asks the same question: what can the user
 * see right now.
 *
 * Ordered worst-first by {@link sortedCpDiagnosticEntries}, and here rather than
 * in the HUD so the list, the markers and the framing agree. Kernel order is
 * vertex order, which was fine while every entry was an error and became useless
 * the moment a mid-design pattern could contribute hundreds of informational
 * rows for the three errors to hide among.
 */
export function visibleCpDiagnosticEntries(
  camvResult: OristudioCpCommandResult | null,
  lastCommandResult: OristudioCpCommandResult | null,
  camvIssuesVisible: boolean
): readonly OristudioCpDiagnosticEntry[] {
  const overlay = camvIssuesVisible ? (camvResult?.diagnostic_entries ?? NONE) : NONE;
  const isHiddenCamvCommand = !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv';
  const command =
    lastCommandResult &&
    isDiagnosticResultOperation(lastCommandResult.operation) &&
    !isHiddenCamvCommand
      ? (lastCommandResult.diagnostic_entries ?? NONE)
      : NONE;

  // A CheckCamv command result *is* the overlay recomputed, so showing both would
  // double every entry.
  if (lastCommandResult?.operation === 'CheckCamv') return sortedCpDiagnosticEntries(command);
  if (overlay.length === 0) return sortedCpDiagnosticEntries(command);
  if (command.length === 0) return sortedCpDiagnosticEntries(overlay);
  return sortedCpDiagnosticEntries([...overlay, ...command]);
}

/** The visible entry with this id, or null — including when it is currently hidden. */
export function visibleCpDiagnosticEntry(
  entries: readonly OristudioCpDiagnosticEntry[],
  id: string | null
): OristudioCpDiagnosticEntry | null {
  if (!id) return null;
  return entries.find((entry) => entry.id === id) ?? null;
}

/**
 * The entry that reports on the vertex at `point`, or null.
 *
 * The same question as {@link visibleCpDiagnosticEntry}, keyed by where instead
 * of by which — for a caller holding a *place* the kernel named and needing the
 * row that already speaks for it. The 3D fold's refusal is the one that has it:
 * it names a point and nothing else, so a dialog with only the refusal can say
 * what is wrong and never where.
 *
 * **First match, not nearest.** Inside {@link SAME_VERTEX} there is no
 * meaningful "nearer" — the kernel would have merged them — and the list arrives
 * from {@link visibleCpDiagnosticEntries} already ordered worst-first, so taking
 * the first is taking the most severe thing said about that vertex. Ranking by
 * distance here would silently overrule that order with floating-point noise.
 */
export function cpDiagnosticEntryAt(
  entries: readonly OristudioCpDiagnosticEntry[],
  point: Point | null | undefined
): OristudioCpDiagnosticEntry | null {
  if (!point) return null;
  return (
    entries.find(
      (entry) =>
        entry.point != null &&
        Math.abs(entry.point.x - point.x) <= SAME_VERTEX &&
        Math.abs(entry.point.y - point.y) <= SAME_VERTEX
    ) ?? null
  );
}

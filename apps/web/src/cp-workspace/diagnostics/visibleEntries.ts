import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import {
  NO_CP_CHECK_SUPPRESSION,
  partitionCpDiagnosticsBySuppression,
  type CpCheckSuppressionRule,
} from './checkSuppression';
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
 *
 * Measured the way the kernel measures it: as a **distance**
 * (`point.distance(segment.a) < CELL`), not as a per-axis box. A box of the same
 * half-width admits the corners, which are √2 × `SAME_VERTEX` apart — points the
 * kernel would not have merged — and that slack would be exactly the second
 * definition the paragraph above disclaims.
 *
 * # The narrowing to a distance costs nothing, and the epsilon itself earns its keep
 *
 * Both halves of that are measured rather than argued, because the two point
 * sets this compares are not bit-identical by construction: the 3D refusal is
 * measured on the snapped, selection-scoped segments and the overlay on the whole
 * document, and `point_line_map` canonicalises a vertex to the *first* endpoint
 * it sees in that cluster — so dropping a segment can move the canonical point,
 * by up to the kernel's own merge epsilon.
 *
 * Over 5,102 refusals that name a place, across the Tier A corpus (5,100 from
 * region-shaped box selections, 2 from folding a whole document):
 *
 * - **0** fall in `(SAME_VERTEX, √2 × SAME_VERTEX]` — the band the per-axis box
 *   used to admit. Nothing was lost by narrowing it.
 * - **37** fall in `(0, SAME_VERTEX]`. Those are real pairs that an exact-equality
 *   test would drop, so the epsilon is doing work and is not decoration.
 * - **86** are exact.
 * - The remaining 4,979 have no row within any radius worth the name: 3,778 are in
 *   documents the overlay reports nothing about at all, and across the rest the
 *   *closest* miss anywhere is 14.3 paper units, with per-file medians of 100 and
 *   165. That is a different vertex, not a rounding difference.
 *
 * A wider epsilon is therefore not the answer to a refusal with no row, and
 * `fold3dRefusalNotice` does not ask for one; it falls back to the place itself.
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
 *
 * `rules` is the scoped check filter (`checkSuppression.ts`) — the document-wide
 * per-class rule and any suppression regions. It is applied here because this is
 * the chokepoint: a caller that filtered afterwards would leave the canvas
 * markers, or the framing, or a jump-to-diagnostic showing what the HUD had
 * already agreed to hide. Omitting it is the unfiltered behaviour, unchanged
 * down to the returned array's identity.
 */
export function visibleCpDiagnosticEntries(
  camvResult: OristudioCpCommandResult | null,
  lastCommandResult: OristudioCpCommandResult | null,
  camvIssuesVisible: boolean,
  rules: readonly CpCheckSuppressionRule[] = NO_CP_CHECK_SUPPRESSION
): readonly OristudioCpDiagnosticEntry[] {
  return visibleCpDiagnostics(camvResult, lastCommandResult, camvIssuesVisible, rules).entries;
}

export interface VisibleCpDiagnostics {
  /** What the canvas, the HUD list and a jump-to-diagnostic can reach. */
  entries: readonly OristudioCpDiagnosticEntry[];
  /**
   * How many findings the scoped rules removed.
   *
   * Reported because a filter whose cost is invisible is how "no errors" comes to
   * mean "no errors we told you about". Every suppressible rule is an
   * error-severity entry, so this is a count of findings and not of
   * informational rows.
   */
  hiddenCount: number;
}

/**
 * {@link visibleCpDiagnosticEntries}, plus what the filter took away.
 *
 * One function rather than a second pass at the call site: the two numbers have
 * to be computed from the same union, or the HUD's headline and its hidden count
 * would be describing different documents.
 */
export function visibleCpDiagnostics(
  camvResult: OristudioCpCommandResult | null,
  lastCommandResult: OristudioCpCommandResult | null,
  camvIssuesVisible: boolean,
  rules: readonly CpCheckSuppressionRule[] = NO_CP_CHECK_SUPPRESSION
): VisibleCpDiagnostics {
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
  const combined =
    lastCommandResult?.operation === 'CheckCamv'
      ? command
      : overlay.length === 0
        ? command
        : command.length === 0
          ? overlay
          : [...overlay, ...command];

  // Filtered before sorting, which is the same list either way, and before the
  // count is taken — the union is the only set both numbers can honestly come
  // from.
  const { visible, hidden } = partitionCpDiagnosticsBySuppression(combined, rules);
  return { entries: sortedCpDiagnosticEntries(visible), hiddenCount: hidden.length };
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
        Math.hypot(entry.point.x - point.x, entry.point.y - point.y) <= SAME_VERTEX
    ) ?? null
  );
}

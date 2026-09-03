/**
 * Everything the diagnostic HUD needs from the store, and nothing else.
 *
 * The HUD takes no props. It is mounted inside the crease-pattern panel's
 * viewport, but the panel is a composition site — it should not be assembling a
 * status object, holding an entry list, and adapting a select callback on the
 * HUD's behalf. So the bindings live here, beside the modules they derive from,
 * and `CpDiagnosticHud` calls this directly.
 *
 * The subscriptions are deliberately narrow. The HUD sits above a canvas that
 * re-renders on nearly every interaction; selecting whole slices here would make
 * every drag re-render a list that has not changed.
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import { cpCheckSuppressionRules, cpCommandResultWithSuppression } from './checkSuppression';
import {
  diagnosticHudStatus,
  diagnosticHudStatusForEntries,
  diagnosticOperationLabel,
  isDiagnosticResultOperation,
  type CpDiagnosticHudStatus,
} from './hudStatus';
import { visibleCpDiagnostics } from './visibleEntries';

export interface CpDiagnosticList {
  /** Every diagnostic currently on the canvas, in kernel order. */
  entries: readonly OristudioCpDiagnosticEntry[];
  /** The collapsed HUD's headline, or null when there is nothing to report. */
  status: CpDiagnosticHudStatus | null;
  /**
   * How many findings the scoped check filter is hiding — the document-wide rule
   * plus any suppression region.
   *
   * The design's safety affordance, and the reason a region may not be `hidden`:
   * a filter you cannot see the cost of turns "no errors" into "no errors we
   * told you about". Zero whenever nothing is suppressed.
   */
  hiddenCount: number;
  activeId: string | null;
  selectDiagnostic: (id: string) => void;
}

export function useCpDiagnosticList(): CpDiagnosticList {
  const { t } = useTranslation();
  const camvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const lastCommandResult = useWorkspaceStore(
    (state) => state.oristudioCpDocument?.lastCommandResult ?? null
  );
  const camvIssuesVisible = useWorkspaceStore(
    (state) => state.oristudioCpViewport.camvIssuesVisible !== false
  );
  const suppressedCheckClasses = useWorkspaceStore(
    (state) => state.oristudioCpViewport.suppressedCheckClasses
  );
  const annotations = useWorkspaceStore((state) => state.oristudioCpAnnotations);
  const activeId = useWorkspaceStore((state) => state.oristudioCpActiveDiagnosticId);
  const setActive = useWorkspaceStore((state) => state.setOristudioCpActiveDiagnostic);

  // The document-wide rule and every region's, composed the ordinary way:
  // document default, regional override.
  //
  // Subscribing to the whole annotation array is wider than this hook's usual
  // discipline, and it costs nothing in the case that matters: with no regions
  // and nothing suppressed `cpCheckSuppressionRules` hands back its shared empty
  // list, so dragging an image re-runs this memo and leaves `rules` identical —
  // and the entry list below never recomputes.
  const rules = useMemo(
    () => cpCheckSuppressionRules(suppressedCheckClasses, annotations),
    [annotations, suppressedCheckClasses]
  );

  // The same call the canvas overlay makes.
  //
  // This used to be its own rule that picked ONE result — the CAMV overlay, or
  // the last command's findings — while the canvas concatenated both. With the
  // overlay on and a Check1 result present, the canvas drew markers the list had
  // no row for: clickable, framed by the store, and unselectable from here.
  //
  // `visibleEntries.ts` already says why there is one function: markers, this
  // list, and what a jump-to-diagnostic can reach all ask the same question.
  const { entries, hiddenCount } = useMemo(
    () => visibleCpDiagnostics(camvResult, lastCommandResult, camvIssuesVisible, rules),
    [camvIssuesVisible, camvResult, lastCommandResult, rules]
  );

  // Which check names the headline, and whether a clean result is worth showing.
  //
  // The overlay names it whenever it has something to report — CAMV re-runs after
  // every edit, so it is the standing account of the document — and an explicit
  // check command names it otherwise. `issueOnly` follows: a clean overlay is
  // silent, a clean command the user ran on purpose says "OK".
  //
  // Both results are filtered **before** they are asked to name anything. The
  // chokepoint above covers the counts, because those already derive from
  // `entries` — but naming reads the result itself, so an unfiltered CAMV would
  // put "Foldability" over a list the filter had emptied, and an unfiltered
  // Check4 would say "Maekawa/BLB OK" over findings it had merely hidden. The
  // honest version of "OK" under a filter is `hiddenCount` beside it.
  const headline = useMemo(() => {
    const camvShown = cpCommandResultWithSuppression(camvResult, rules);
    const camvNames =
      camvIssuesVisible && diagnosticHudStatus(t, camvShown, { issueOnly: true }) !== null;
    if (camvNames && camvShown) return { result: camvShown, issueOnly: true };
    const command =
      !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
        ? null
        : cpCommandResultWithSuppression(lastCommandResult, rules);
    return command ? { result: command, issueOnly: false } : null;
  }, [camvIssuesVisible, camvResult, lastCommandResult, rules, t]);

  // Counted from `entries` — what the list actually shows — rather than from the
  // naming result's own entries, which is a different set whenever both the
  // overlay and a check command contribute.
  const status = useMemo(() => {
    if (!headline) return null;
    const { result, issueOnly } = headline;
    if (!isDiagnosticResultOperation(result.operation) || !result.diagnostics.length) return null;
    return diagnosticHudStatusForEntries(
      t,
      diagnosticOperationLabel(t, result.operation),
      entries,
      // The coverage count comes from the naming result even though the entries
      // do not: it is a statement about what that check examined, and there is
      // no such thing as the union of two checks' coverage.
      { issueOnly, checkedVertices: result.checked_vertices }
    );
  }, [entries, headline, t]);

  const selectDiagnostic = useCallback((id: string) => setActive(id), [setActive]);

  return { entries, status, hiddenCount, activeId, selectDiagnostic };
}

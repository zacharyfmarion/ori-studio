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
import {
  diagnosticHudStatus,
  diagnosticHudStatusForEntries,
  diagnosticOperationLabel,
  isDiagnosticResultOperation,
  type CpDiagnosticHudStatus,
} from './hudStatus';
import { visibleCpDiagnosticEntries } from './visibleEntries';

export interface CpDiagnosticList {
  /** Every diagnostic currently on the canvas, in kernel order. */
  entries: readonly OristudioCpDiagnosticEntry[];
  /** The collapsed HUD's headline, or null when there is nothing to report. */
  status: CpDiagnosticHudStatus | null;
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
  const activeId = useWorkspaceStore((state) => state.oristudioCpActiveDiagnosticId);
  const setActive = useWorkspaceStore((state) => state.setOristudioCpActiveDiagnostic);

  // The same call the canvas overlay makes.
  //
  // This used to be its own rule that picked ONE result — the CAMV overlay, or
  // the last command's findings — while the canvas concatenated both. With the
  // overlay on and a Check1 result present, the canvas drew markers the list had
  // no row for: clickable, framed by the store, and unselectable from here.
  //
  // `visibleEntries.ts` already says why there is one function: markers, this
  // list, and what a jump-to-diagnostic can reach all ask the same question.
  const entries = useMemo(
    () => visibleCpDiagnosticEntries(camvResult, lastCommandResult, camvIssuesVisible),
    [camvIssuesVisible, camvResult, lastCommandResult]
  );

  // Which check names the headline, and whether a clean result is worth showing.
  //
  // The overlay names it whenever it has something to report — CAMV re-runs after
  // every edit, so it is the standing account of the document — and an explicit
  // check command names it otherwise. `issueOnly` follows: a clean overlay is
  // silent, a clean command the user ran on purpose says "OK".
  const headline = useMemo(() => {
    const camvNames =
      camvIssuesVisible && diagnosticHudStatus(t, camvResult, { issueOnly: true }) !== null;
    if (camvNames && camvResult) return { result: camvResult, issueOnly: true };
    const command =
      !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv' ? null : lastCommandResult;
    return command ? { result: command, issueOnly: false } : null;
  }, [camvIssuesVisible, camvResult, lastCommandResult, t]);

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

  return { entries, status, activeId, selectDiagnostic };
}
